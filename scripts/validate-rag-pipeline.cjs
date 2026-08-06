const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH;
const DEFAULT_CASES_PATH = path.join(__dirname, 'rag-test-cases.json');
const DEFAULT_EMBEDDING = 'minilm';

async function main() {
  for (const [name, value] of Object.entries({
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH,
  })) {
    if (!value) {
      console.error(`Missing required env var: ${name}`);
      process.exit(1);
    }
  }

  const args = parseArgs(process.argv.slice(2));
  const casesPath = path.resolve(args.cases || DEFAULT_CASES_PATH);
  const threshold = Number.isFinite(args.threshold) ? args.threshold : 70;
  const embeddingMode = normalizeEmbeddingMode(args.embedding || DEFAULT_EMBEDDING);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const auth = new google.auth.GoogleAuth({
    keyFile: GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  await printDurationReport(supabase, drive);

  const cases = loadCases(casesPath);
  if (cases.length === 0) {
    console.error(`No test cases found at ${casesPath}. Populate scripts/rag-test-cases.json with real examples and rerun.`);
    process.exit(1);
  }

  const { embedRawClipText, embedWithGemini, groupSegmentMatchesByAd } = await import('../lib/raw-clips.js');
  const expectedAdIds = [...new Set(cases.map((item) => item.expected_ad_id))];
  const { data: expectedAds, error: expectedAdsError } = await supabase
    .from('ads')
    .select('id, name')
    .in('id', expectedAdIds);

  if (expectedAdsError) throw new Error(`Failed to load expected ad names: ${expectedAdsError.message}`);
  const adNameById = new Map((expectedAds || []).map((ad) => [ad.id, ad.name || ad.id]));

  const summaryRows = [];
  let recall1 = 0;
  let recall5 = 0;
  let recall10 = 0;
  const correctTop1Scores = [];
  const incorrectTop1Scores = [];

  console.log(`Running validation with ${embeddingMode.toUpperCase()} embeddings.`);

  for (const testCase of cases) {
    const queryEmbedding = embeddingMode === 'gemini'
      ? await embedWithGemini(testCase.query)
      : await embedRawClipText(testCase.query);

    const rpcName = embeddingMode === 'gemini' ? 'match_clip_segments_gemini' : 'match_clip_segments';
    const { data, error } = await supabase.rpc(rpcName, {
      query_embedding: queryEmbedding,
      match_count: 40,
      similarity_threshold: 0.25,
    });

    if (error) {
      throw new Error(`RPC failed for query "${testCase.query}": ${error.message}`);
    }

    const ranked = groupSegmentMatchesByAd(data || [], 10);
    const expectedRank = ranked.findIndex((item) => item.ad_id === testCase.expected_ad_id);
    const top1 = ranked[0] || null;
    const top1Similarity = top1 ? Number(top1.similarity) : null;

    if (expectedRank === 0) recall1 += 1;
    if (expectedRank >= 0 && expectedRank < 5) recall5 += 1;
    if (expectedRank >= 0 && expectedRank < 10) recall10 += 1;

    if (top1) {
      if (top1.ad_id === testCase.expected_ad_id) {
        correctTop1Scores.push(Number(top1.similarity));
      } else {
        incorrectTop1Scores.push(Number(top1.similarity));
      }
    }

    summaryRows.push({
      query: testCase.query,
      expected: `${adNameById.get(testCase.expected_ad_id) || testCase.expected_ad_id}`,
      rank: expectedRank >= 0 ? expectedRank + 1 : 'not in top 10',
      expected_ad_id: testCase.expected_ad_id,
      top1_ad_id: top1 ? top1.ad_id : null,
      top1_similarity: top1Similarity,
      notes: testCase.notes || '',
    });
  }

  console.table(summaryRows);

  const total = cases.length;
  const metrics = {
    recallAt1: pct(recall1, total),
    recallAt5: pct(recall5, total),
    recallAt10: pct(recall10, total),
    avgCorrectTop1Similarity: avg(correctTop1Scores),
    avgIncorrectTop1Similarity: avg(incorrectTop1Scores),
    similarityGap: avg(correctTop1Scores) != null && avg(incorrectTop1Scores) != null
      ? avg(correctTop1Scores) - avg(incorrectTop1Scores)
      : null,
  };

  console.log('\nMetrics');
  console.log(`Recall@1: ${metrics.recallAt1.toFixed(1)}%`);
  console.log(`Recall@5: ${metrics.recallAt5.toFixed(1)}%`);
  console.log(`Recall@10: ${metrics.recallAt10.toFixed(1)}%`);
  console.log(`Average similarity for correct top-1 matches: ${fmt(metrics.avgCorrectTop1Similarity)}`);
  console.log(`Average similarity for incorrect top-1 matches: ${fmt(metrics.avgIncorrectTop1Similarity)}`);
  console.log(`Similarity gap (correct - incorrect): ${fmt(metrics.similarityGap)}`);

  if (metrics.recallAt5 < threshold) {
    console.error(`Recall@5 ${metrics.recallAt5.toFixed(1)}% is below threshold ${threshold.toFixed(1)}%`);
    process.exit(1);
  }
}

async function printDurationReport(supabase, drive) {
  const { data: ads, error } = await supabase
    .from('ads')
    .select('id, name, raw_footage_url')
    .not('raw_footage_url', 'is', null);

  if (error) throw new Error(`Failed to read ads for duration report: ${error.message}`);

  const cache = new Map();
  let totalDurationMs = 0;
  let longestClipMs = 0;
  let clipsWithDuration = 0;
  let unresolved = 0;

  for (const row of ads || []) {
    const meta = await resolveDriveMeta(drive, row.raw_footage_url, cache);
    if (!meta || !meta.durationMillis) {
      unresolved += 1;
      continue;
    }
    clipsWithDuration += 1;
    totalDurationMs += meta.durationMillis;
    longestClipMs = Math.max(longestClipMs, meta.durationMillis);
  }

  const totalDurationSeconds = totalDurationMs / 1000;
  const estimated1sSegments = Math.ceil(totalDurationSeconds);
  const estimatedOldSegments = Math.ceil(totalDurationSeconds / 2.5);
  const estimatedCalls = (ads || []).length;

  console.log('\nDuration report');
  console.log(`Clips with footage URLs: ${(ads || []).length}`);
  console.log(`Clips with resolved durations: ${clipsWithDuration}`);
  console.log(`Unresolved clips: ${unresolved}`);
  console.log(`Total combined duration: ${formatSeconds(totalDurationSeconds)}`);
  console.log(`Estimated Gemini calls for a full backfill: ${estimatedCalls}`);
  console.log(`Estimated 1s segments: ${estimated1sSegments}`);
  console.log(`Estimated old 2-3s segments: ${estimatedOldSegments}`);
  console.log(`Rough output increase vs old approach: ${(estimated1sSegments / Math.max(1, estimatedOldSegments)).toFixed(2)}x`);
  console.log(`Longest clip: ${formatSeconds(longestClipMs / 1000)}`);

  if (longestClipMs > 120000) {
    console.warn(`[LONG] A clip exceeds 2 minutes (${formatSeconds(longestClipMs / 1000)}); consider chunking before a full second-level backfill.`);
  }
}

async function resolveDriveMeta(drive, rawFootageUrl, cache) {
  const fileId = extractDriveFileId(rawFootageUrl);
  if (fileId) {
    const key = `file:${fileId}`;
    if (cache.has(key)) return cache.get(key);
    const meta = await drive.files.get({ fileId, fields: 'name, mimeType, size, videoMediaMetadata(durationMillis)' });
    const resolved = {
      durationMillis: Number(meta.data.videoMediaMetadata?.durationMillis || 0),
    };
    cache.set(key, resolved);
    return resolved;
  }

  const folderId = extractDriveFolderId(rawFootageUrl);
  if (!folderId) return null;
  const key = `folder:${folderId}`;
  if (cache.has(key)) return cache.get(key);

  const list = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`,
    fields: 'files(id, name, mimeType, size, videoMediaMetadata(durationMillis))',
    pageSize: 1,
    orderBy: 'createdTime',
  });
  const file = (list.data.files || [])[0] || null;
  const resolved = file ? { durationMillis: Number(file.videoMediaMetadata?.durationMillis || 0) } : null;
  cache.set(key, resolved);
  return resolved;
}

function extractDriveFileId(url) {
  if (!url) return null;
  const patterns = [/\/file\/d\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/, /\/d\/([a-zA-Z0-9_-]+)/];
  for (const re of patterns) {
    const match = url.match(re);
    if (match) return match[1];
  }
  return null;
}

function extractDriveFolderId(url) {
  if (!url) return null;
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function loadCases(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Test cases file must contain a JSON array: ${filePath}`);
  }
  return parsed.filter((entry) => entry && typeof entry.query === 'string' && typeof entry.expected_ad_id === 'string');
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--cases') result.cases = argv[++i];
    else if (value === '--threshold') result.threshold = Number(argv[++i]);
    else if (value.startsWith('--embedding=')) result.embedding = value.split('=')[1];
    else if (value === '--embedding') result.embedding = argv[++i];
  }
  return result;
}

function normalizeEmbeddingMode(mode) {
  const normalized = String(mode || '').toLowerCase();
  if (normalized === 'minilm' || normalized === 'gemini') {
    return normalized;
  }
  throw new Error(`Invalid embedding mode: ${mode}. Use --embedding=minilm or --embedding=gemini.`);
}

function pct(part, total) {
  return total > 0 ? (part / total) * 100 : 0;
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fmt(value) {
  return value == null ? 'n/a' : value.toFixed(3);
}

function formatSeconds(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});