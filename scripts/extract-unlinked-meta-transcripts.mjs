import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const GRAPH_VERSION = 'v23.0';
const DEEPGRAM_MODEL = process.env.DEEPGRAM_TRANSCRIPT_MODEL || 'nova-3';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const deepgramKey = process.env.DEEPGRAM_API_KEY;
const metaToken = process.env.META_ACCESS_TOKEN;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function loadStoredMediaVideos() {
  const file = path.resolve(process.cwd(), 'app/live-media-videos.ts');
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^export const mediaVideos = /, 'globalThis.mediaVideos = ');
    const context = {};
    vm.runInNewContext(text, context);
    return Array.isArray(context.mediaVideos) ? context.mediaVideos : [];
  } catch {
    return [];
  }
}

async function graphGet(base, token, params) {
  const url = new URL(base);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Meta returned HTTP ${response.status}`);
  }
  return payload;
}

let pageTokensPromise = null;
async function getPageTokens(token) {
  if (!pageTokensPromise) {
    pageTokensPromise = graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, token, {
      fields: 'id,access_token',
      limit: '100'
    })
      .then((payload) => new Map((payload.data || []).filter((page) => page.id && page.access_token).map((page) => [page.id, page.access_token])))
      .catch(() => new Map());
  }
  return pageTokensPromise;
}

function findPageId(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.page_id === 'string' && value.page_id) return value.page_id;
  if (Array.isArray(value)) {
    for (const item of value) {
      const pageId = findPageId(item);
      if (pageId) return pageId;
    }
    return null;
  }
  for (const child of Object.values(value)) {
    const pageId = findPageId(child);
    if (pageId) return pageId;
  }
  return null;
}

function findVideoIds(value, found = new Set()) {
  if (!value || typeof value !== 'object') return [...found];
  if (typeof value.video_id === 'string' && value.video_id) found.add(value.video_id);
  if (Array.isArray(value)) {
    for (const item of value) {
      findVideoIds(item, found);
    }
    return [...found];
  }
  for (const child of Object.values(value)) {
    findVideoIds(child, found);
  }
  return [...found];
}

async function getVideoSource(videoId, creative, token) {
  const userVideo = await graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/${videoId}`, token, { fields: 'id,source,format' })
    .catch((err) => ({ source: null, error: err.message }));
  if (userVideo.source || userVideo.error) return userVideo;

  const pageId = findPageId(creative);
  if (!pageId) return userVideo;
  const pageToken = (await getPageTokens(token)).get(pageId);
  if (!pageToken) return userVideo;
  return graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/${videoId}`, pageToken, { fields: 'id,source,format' })
    .catch((err) => ({ source: null, error: err.message }));
}

async function getMetaAdCreative(metaAdId, token) {
  if (process.env.META_AD_ACCOUNT_ID) {
    const account = process.env.META_AD_ACCOUNT_ID.replace(/^act_/, '');
    const payload = await graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/act_${account}/ads`, token, {
      limit: '1',
      filtering: JSON.stringify([{ field: 'ad.id', operator: 'IN', value: [metaAdId] }]),
      fields: 'id,creative{id,video_id,object_story_spec,asset_feed_spec}'
    });
    if (payload.data?.[0]) return payload.data[0];
  }
  return graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/${metaAdId}`, token, {
    fields: 'id,creative{id,video_id,object_story_spec,asset_feed_spec}'
  });
}

async function transcribeVideoSource(source) {
  if (!deepgramKey) throw new Error('DEEPGRAM_API_KEY is not configured in .env.local');
  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', DEEPGRAM_MODEL);
  url.searchParams.set('language', 'multi');
  url.searchParams.set('filler_words', 'true');
  url.searchParams.set('diarize', 'true');
  url.searchParams.set('utterances', 'true');
  url.searchParams.set('words', 'true');
  url.searchParams.set('punctuate', 'true');
  url.searchParams.set('smart_format', 'false');
  url.searchParams.set('numerals', 'false');

  const transcription = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${deepgramKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: source })
  });

  const payload = await transcription.json();
  if (!transcription.ok) {
    throw new Error(payload.err_msg || payload.message || `Deepgram returned HTTP ${transcription.status}`);
  }

  const alternatives = (payload.results?.channels || []).map((c) => c.alternatives?.[0]).filter(Boolean);
  const words = alternatives.flatMap((a) => a.words || []);
  const wordTranscript = words
    .map((w) => w.punctuated_word || w.word)
    .filter(Boolean)
    .join(' ')
    .trim();
  const transcript = (wordTranscript || alternatives.map((a) => a.transcript || '').join(' ')).trim();
  if (!transcript) throw new Error('Deepgram returned an empty transcript.');

  const channel = payload.results?.channels?.[0] || {};
  const language =
    channel.detected_language ||
    alternatives.find((a) => a.detected_language)?.detected_language ||
    [...new Set(words.map((w) => w.language).filter(Boolean))].join(',') ||
    'multi';

  return {
    transcript,
    language,
    languageConfidence: channel.language_confidence ?? alternatives.find((a) => a.language_confidence != null)?.language_confidence ?? null,
    wordTimings: words.map((w) => ({
      word: w.punctuated_word || w.word,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
      language: w.language ?? null,
      speaker: w.speaker ?? null
    }))
  };
}

async function extractMetaAd(metaAdId, token, storedVideos) {
  const storedMatch = storedVideos.find((v) => v.adId === metaAdId);
  if (storedMatch?.url) {
    try {
      const transcription = await transcribeVideoSource(storedMatch.url);
      return [{
        metaAdId,
        creativeId: storedMatch.creativeId || null,
        videoId: storedMatch.videoId || null,
        videoSource: storedMatch.url,
        ...transcription,
        error: null
      }];
    } catch (err) {
      return [{
        metaAdId,
        creativeId: storedMatch.creativeId || null,
        videoId: storedMatch.videoId || null,
        videoSource: storedMatch.url,
        transcript: null,
        error: err.message
      }];
    }
  }

  const ad = await getMetaAdCreative(metaAdId, token);
  const creativeId = ad.creative?.id || null;
  const videoIds = findVideoIds(ad.creative);
  if (!videoIds.length) {
    return [{ metaAdId, creativeId, videoId: null, videoSource: null, transcript: null, error: 'No video ID found on this Meta ad creative.' }];
  }

  const results = [];
  for (const videoId of videoIds) {
    const video = await getVideoSource(videoId, ad.creative, token);
    if (video.error) {
      results.push({ metaAdId, creativeId, videoId, videoSource: null, transcript: null, error: `Could not read Meta video ${videoId}: ${video.error}` });
    } else if (!video.source) {
      results.push({ metaAdId, creativeId, videoId, videoSource: null, transcript: null, error: 'Meta did not return a raw video source URL for this video.' });
    } else {
      try {
        const transcription = await transcribeVideoSource(video.source);
        results.push({ metaAdId, creativeId, videoId, videoSource: video.source, ...transcription, error: null });
      } catch (err) {
        results.push({ metaAdId, creativeId, videoId, videoSource: video.source, transcript: null, error: err.message });
      }
    }
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const transcribeNew = args.includes('--transcribe');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;

  console.log('Loading Meta Ads and Creative Library data...');

  const [
    { data: metaAds, error: metaAdsError },
    { data: creativeAds, error: creativeAdsError },
    { data: existingMappings, error: mappingsError }
  ] = await Promise.all([
    supabase.from('meta_ads').select('id, name, spend').order('spend', { ascending: false }),
    supabase.from('ads').select('id, name'),
    supabase.from('meta_ad_transcript_mappings').select('*')
  ]);

  if (metaAdsError) throw metaAdsError;
  if (creativeAdsError) throw creativeAdsError;
  if (mappingsError) throw mappingsError;

  const creativeNames = new Set((creativeAds || []).map((a) => (a.name || '').trim().toUpperCase()));
  const exactByMapping = new Set((existingMappings || []).filter((m) => m.transcript_source === 'exact_creative_id').map((m) => m.meta_ad_id));
  const exactByName = new Set((metaAds || []).filter((m) => creativeNames.has((m.name || '').trim().toUpperCase())).map((m) => m.id));
  const exactLinkedSet = new Set([...exactByMapping, ...exactByName]);

  // Identify unlinked Meta Ads
  const unlinkedAds = (metaAds || []).filter((m) => !exactLinkedSet.has(m.id));
  console.log(`Found ${metaAds.length} total Meta ads. ${exactLinkedSet.size} are exact-linked by creative ID.`);
  console.log(`Identified ${unlinkedAds.length} unlinked Meta ads.`);

  const mappingsByMetaId = new Map();
  for (const m of existingMappings || []) {
    mappingsByMetaId.set(m.meta_ad_id, m);
  }

  const storedVideos = loadStoredMediaVideos();
  console.log(`Found ${storedVideos.length} cached media videos in app/live-media-videos.ts.`);

  let newlyTranscribed = 0;
  if (transcribeNew) {
    if (!metaToken) throw new Error('META_ACCESS_TOKEN is required for transcribing new ads.');
    const needed = unlinkedAds.filter((ad) => {
      const m = mappingsByMetaId.get(ad.id);
      return !m || (!m.transcript && m.transcript_status !== 'failed');
    }).slice(0, limit);

    console.log(`\nTranscribing up to ${needed.length} pending unlinked Meta ads with Deepgram nova-3 multi...`);

    for (let i = 0; i < needed.length; i++) {
      const ad = needed[i];
      process.stdout.write(`[${i + 1}/${needed.length}] Processing Meta ad ${ad.id} ("${ad.name || 'unnamed'}")... `);
      const extractedList = await extractMetaAd(ad.id, metaToken, storedVideos);

      for (const extracted of extractedList) {
        const mappingKey = ['meta', ad.id, 'creative', extracted.creativeId || 'primary', 'video', extracted.videoId || 'primary'].join(':');
        const isAvail = Boolean(extracted.transcript);
        const row = {
          mapping_key: mappingKey,
          meta_ad_id: ad.id,
          meta_creative_id: extracted.creativeId,
          meta_video_id: extracted.videoId,
          transcript: extracted.transcript || null,
          transcript_hash: extracted.transcript ? crypto.createHash('sha256').update(extracted.transcript).digest('hex') : null,
          transcript_language: extracted.language || null,
          transcript_language_confidence: extracted.languageConfidence || null,
          transcript_word_timings: extracted.wordTimings || null,
          transcript_source: 'meta_graph_deepgram',
          transcript_status: isAvail ? 'available' : 'failed',
          transcript_error: extracted.error || null,
          matched_ad_id: null,
          match_score: 0,
          match_confidence: 'unmatched',
          matched_tokens: 0,
          transcript_token_count: extracted.transcript ? extracted.transcript.split(/\s+/).length : 0,
          script_token_count: 0,
          mapped_at: new Date().toISOString()
        };

        const { error: upsertErr } = await supabase.from('meta_ad_transcript_mappings').upsert([row], { onConflict: 'mapping_key' });
        if (upsertErr) {
          console.log(`DB error: ${upsertErr.message}`);
        } else {
          mappingsByMetaId.set(ad.id, row);
          if (isAvail) {
            newlyTranscribed++;
            console.log(`Transcribed! (${extracted.language}, ${row.transcript_token_count} words)`);
          } else {
            console.log(`Failed: ${extracted.error}`);
          }
        }
      }
    }
  }

  // Compile the master document of ALL unlinked Meta ads
  console.log('\nCompiling master document of all unlinked Meta ad transcripts...');
  const compiledRecords = [];
  let availableCount = 0;
  let emptyCount = 0;

  for (const ad of unlinkedAds) {
    const m = mappingsByMetaId.get(ad.id);
    const hasTranscript = Boolean(m && m.transcript && m.transcript.trim().length > 0);
    if (hasTranscript) availableCount++;
    else emptyCount++;

    compiledRecords.push({
      meta_ad_id: ad.id,
      meta_ad_name: ad.name || '',
      spend: Number(ad.spend || 0),
      status: hasTranscript ? 'transcript_available' : m?.transcript_status || 'not_transcribed',
      language: m?.transcript_language || null,
      language_confidence: m?.transcript_language_confidence || null,
      meta_creative_id: m?.meta_creative_id || null,
      meta_video_id: m?.meta_video_id || null,
      transcript: m?.transcript || null,
      word_count: m?.transcript ? m.transcript.split(/\s+/).filter(Boolean).length : 0,
      transcript_error: m?.transcript_error || null,
      previously_matched_ad_id: m?.matched_ad_id || null,
      mapping_key: m?.mapping_key || null
    });
  }

  // Ensure data directory exists
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // 1. Write JSON file
  const jsonPath = path.join(dataDir, 'unlinked-meta-ad-transcripts.json');
  fs.writeFileSync(jsonPath, JSON.stringify(compiledRecords, null, 2), 'utf8');
  console.log(`Saved JSON: ${jsonPath} (${compiledRecords.length} records, ${availableCount} with transcripts)`);

  // 2. Write Markdown file
  const mdPath = path.join(dataDir, 'unlinked-meta-ad-transcripts.md');
  const mdHeader = [
    '# Unlinked Meta Ads Transcripts Catalog (Multilingual Deepgram)',
    `Generated on: ${new Date().toISOString()}`,
    `Total Unlinked Meta Ads: ${compiledRecords.length}`,
    `Ads with Multilingual Transcripts: ${availableCount}`,
    `Ads without Transcript / Non-Video / Silent: ${emptyCount}`,
    '',
    '---',
    ''
  ].join('\n');

  let mdContent = mdHeader;
  for (const item of compiledRecords) {
    mdContent += `### Meta Ad: ${item.meta_ad_name || 'Unnamed'} (ID: ${item.meta_ad_id})\n`;
    mdContent += `- **Spend**: ₹${item.spend.toLocaleString('en-IN')}\n`;
    mdContent += `- **Status**: ${item.status}\n`;
    mdContent += `- **Detected Language**: ${item.language || 'N/A'}\n`;
    if (item.word_count) mdContent += `- **Word Count**: ${item.word_count}\n`;
    if (item.transcript_error) mdContent += `- **Extraction Note**: ${item.transcript_error}\n`;
    mdContent += `\n**Multilingual Transcript**:\n\`\`\`\n${item.transcript || '[No Transcript Available]'}\n\`\`\`\n\n---\n\n`;
  }

  fs.writeFileSync(mdPath, mdContent, 'utf8');
  console.log(`Saved Markdown: ${mdPath}`);

  console.log('\nStage 2 Summary:');
  console.log(`- Total Unlinked Meta Ads: ${compiledRecords.length}`);
  console.log(`- Available Multilingual Transcripts: ${availableCount}`);
  console.log(`- Missing / Silent / Image Ads: ${emptyCount}`);
  if (newlyTranscribed > 0) console.log(`- Newly Extracted via Deepgram: ${newlyTranscribed}`);
}

main().catch((err) => {
  console.error('Stage 2 failed:', err);
  process.exit(1);
});
