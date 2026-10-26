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
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      const message = payload.error?.message || `Meta returned HTTP ${response.status}`;
      // (#4) / (#17) / (#32): Meta application rate limit. Wait and retry instead of recording a failure.
      if (attempt < 4 && /request limit|rate limit|\(#4\)|\(#17\)|\(#32\)/i.test(message)) {
        console.log(`  Meta rate limit hit, waiting 70s (retry ${attempt + 1}/4)...`);
        await new Promise((resolve) => setTimeout(resolve, 70000));
        continue;
      }
      throw new Error(message);
    }
    return payload;
  }
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
      // Cached signed URLs expire (403); fall through to a fresh source URL from Meta.
      console.log(`cached URL failed (${err.message.slice(0, 60)}), retrying live from Meta...`);
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

const PRIORITY_MIN_SPEND = 1000;
const PRIORITY_WINDOW_DAYS = 30;
const PRIORITY_MAX_CREATIVES = 70;

// Same rules the Meta sync uses to attribute an ad by name / AFLOW tag.
function matchesByNameOrTag(metaName, creativeName, ads) {
  const source = `${metaName || ''} ${creativeName || ''}`;
  const explicitIds = [...source.matchAll(/AFLOW\s*:\s*([0-9a-f]{8}-[0-9a-f-]{27,})/gi)].map((m) => m[1].toLowerCase());
  if (explicitIds.length && ads.some((ad) => explicitIds.includes(ad.id.toLowerCase()))) return true;
  const tokens = new Set(source.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  return ads.some((ad) => {
    const tag = (ad.name || '').trim().toUpperCase();
    return tag.length >= 5 && /[A-Z]/.test(tag) && /\d/.test(tag) && !/[^A-Z0-9]/.test(tag) && tokens.has(tag);
  });
}

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await buildQuery().range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function loadRecentAssetSpend(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const spendByAsset = new Map();
  const rows = await fetchAll(() => supabase.from('meta_ad_asset_daily_metrics').select('meta_asset_id, spend').gte('metric_date', since).order('meta_asset_id').order('metric_date'));
  for (const row of rows) spendByAsset.set(row.meta_asset_id, (spendByAsset.get(row.meta_asset_id) || 0) + Number(row.spend || 0));
  return spendByAsset;
}

async function loadRecentSpend(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const spendByAd = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('meta_ad_daily_metrics')
      .select('meta_ad_id, spend')
      .gte('metric_date', since)
      .order('meta_ad_id')
      .order('metric_date')
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data || []) spendByAd.set(row.meta_ad_id, (spendByAd.get(row.meta_ad_id) || 0) + Number(row.spend || 0));
    if (!data || data.length < 1000) break;
  }
  return spendByAd;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const transcribeNew = args.includes('--transcribe');
  const retryFailed = args.includes('--retry-failed');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;

  console.log('Loading Meta Ads and Creative Library data...');

  const [
    { data: metaAds, error: metaAdsError },
    { data: creativeAds, error: creativeAdsError },
    { data: existingMappings, error: mappingsError }
  ] = await Promise.all([
    supabase.from('meta_ads').select('id, name, creative_name, spend').order('spend', { ascending: false }),
    supabase.from('ads').select('id, name'),
    fetchAll(() => supabase.from('meta_ad_transcript_mappings').select('*').order('mapping_key')).then((data) => ({ data, error: null }))
  ]);

  if (metaAdsError) throw metaAdsError;
  if (creativeAdsError) throw creativeAdsError;
  if (mappingsError) throw mappingsError;

  const creativeNames = new Set((creativeAds || []).map((a) => (a.name || '').trim().toUpperCase()));
  const exactByMapping = new Set((existingMappings || []).filter((m) => m.transcript_source === 'exact_creative_id').map((m) => m.meta_ad_id));
  const exactByName = new Set((metaAds || []).filter((m) => creativeNames.has((m.name || '').trim().toUpperCase())).map((m) => m.id));
  const exactLinkedSet = new Set([...exactByMapping, ...exactByName]);

  // Identify unlinked Meta Ads
  const allUnlinkedAds = (metaAds || []).filter((m) => !exactLinkedSet.has(m.id) && !matchesByNameOrTag(m.name, m.creative_name, creativeAds || []));
  console.log(`Found ${metaAds.length} total Meta ads. ${metaAds.length - allUnlinkedAds.length} are linked by creative ID / name / tag.`);
  console.log(`Identified ${allUnlinkedAds.length} unlinked Meta ads.`);

  // Priority scope, at CREATIVE level: rank every creative (video) by last-30-day spend and take them while spend >= INR 1,000,
  // stopping at 70 creatives - whichever limit is reached first.
  const candidateAdIds = allUnlinkedAds.map((ad) => ad.id);
  const assets = [];
  for (let i = 0; i < candidateAdIds.length; i += 100) {
    const { data, error } = await supabase.from('meta_ad_assets').select('id, meta_ad_id, asset_label, creative_id, video_id').in('meta_ad_id', candidateAdIds.slice(i, i + 100));
    if (error) throw error;
    assets.push(...(data || []));
  }
  const assetSpend = await loadRecentAssetSpend(PRIORITY_WINDOW_DAYS);
  const adSpend = await loadRecentSpend(PRIORITY_WINDOW_DAYS);
  const adsWithVideoAssets = new Set(assets.filter((a) => a.video_id).map((a) => a.meta_ad_id));
  const seenUnits = new Set();
  const units = [];
  for (const a of assets) {
    if (!a.video_id || seenUnits.has(`${a.meta_ad_id}:${a.video_id}`)) continue;
    seenUnits.add(`${a.meta_ad_id}:${a.video_id}`);
    units.push({ adId: a.meta_ad_id, videoId: a.video_id, creativeId: a.creative_id || null, label: a.asset_label || null, spend30d: assetSpend.get(a.id) || 0 });
  }
  // Ads Meta reports without a per-creative breakdown count as a single creative.
  for (const ad of allUnlinkedAds) if (!adsWithVideoAssets.has(ad.id)) units.push({ adId: ad.id, videoId: null, creativeId: null, label: null, spend30d: adSpend.get(ad.id) || 0 });
  units.sort((x, y) => y.spend30d - x.spend30d);
  const selectedUnits = [];
  for (const u of units) {
    if (selectedUnits.length >= PRIORITY_MAX_CREATIVES || u.spend30d < PRIORITY_MIN_SPEND) break;
    selectedUnits.push(u);
  }
  const adIdsInScope = [...new Set(selectedUnits.map((u) => u.adId))];
  const adLookup = new Map(allUnlinkedAds.map((m) => [m.id, m]));
  const unlinkedAds = adIdsInScope.map((id) => adLookup.get(id));
  console.log(`Priority scope: ${selectedUnits.length} creatives (>= ₹${PRIORITY_MIN_SPEND} spend in the last ${PRIORITY_WINDOW_DAYS} days, max ${PRIORITY_MAX_CREATIVES}) across ${unlinkedAds.length} Meta ads. Candidate creatives: ${units.length}.`);
  if (dryRun) {
    for (const u of selectedUnits) console.log(`${u.adId}\t${u.videoId || 'ad-level'}\t₹${u.spend30d.toFixed(2)}\t${u.label || adLookup.get(u.adId)?.name || ''}`);
    return;
  }

  // ---- Creative-level mapping: one row per VIDEO inside each Meta ad, never one row per ad. ----
  const videosByAd = new Map();
  const labelByVideo = new Map();
  for (const u of selectedUnits) {
    if (!u.videoId) continue;
    labelByVideo.set(`${u.adId}:${u.videoId}`, u.label);
    videosByAd.set(u.adId, [...(videosByAd.get(u.adId) || []), { videoId: u.videoId, creativeId: u.creativeId }]);
  }

  const mappingsByKey = new Map();
  for (const m of existingMappings || []) mappingsByKey.set(m.mapping_key, m);
  const storedVideos = loadStoredMediaVideos();
  console.log(`Found ${storedVideos.length} cached media videos in app/live-media-videos.ts.`);
  const totalVideos = [...videosByAd.values()].reduce((n, v) => n + v.length, 0);
  console.log(`Target ads contain ${totalVideos} known videos (${[...videosByAd.values()].filter((v) => v.length > 1).length} ads have more than one video).`);

  async function saveRow(ad, video, extracted) {
    const mappingKey = ['meta', ad.id, 'creative', video.creativeId || 'primary', 'video', video.videoId || 'primary'].join(':');
    const isAvail = Boolean(extracted.transcript);
    const row = {
      mapping_key: mappingKey,
      meta_ad_id: ad.id,
      meta_creative_id: video.creativeId,
      meta_video_id: video.videoId,
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
    const { error } = await supabase.from('meta_ad_transcript_mappings').upsert([row], { onConflict: 'mapping_key' });
    if (error) { console.log(`DB error: ${error.message}`); return; }
    mappingsByKey.set(mappingKey, row);
    // Drop superseded ad-level rows (no video id) once real per-video rows exist.
    if (video.videoId) {
      await supabase.from('meta_ad_transcript_mappings').delete().eq('meta_ad_id', ad.id).is('meta_video_id', null).neq('transcript_source', 'exact_creative_id');
      for (const [k, v] of mappingsByKey) if (v.meta_ad_id === ad.id && !v.meta_video_id && v.transcript_source !== 'exact_creative_id') mappingsByKey.delete(k);
    }
    console.log(isAvail ? `  video ${video.videoId}: transcribed (${row.transcript_language}, ${row.transcript_token_count} words)` : `  video ${video.videoId || '-'}: FAILED ${extracted.error}`);
  }

  let newlyTranscribed = 0;
  if (transcribeNew) {
    if (!metaToken) throw new Error('META_ACCESS_TOKEN is required for transcribing new ads.');
    let adCount = 0;
    for (const ad of unlinkedAds) {
      adCount++;
      let videos = videosByAd.get(ad.id) || [];
      let adCreative = null;
      if (!videos.length) {
        // No asset breakdown stored: read the creative from Meta to discover its videos.
        try {
          adCreative = await getMetaAdCreative(ad.id, metaToken);
          videos = findVideoIds(adCreative.creative).map((videoId) => ({ videoId, creativeId: adCreative.creative?.id || null }));
        } catch (err) {
          console.log(`[${adCount}/${unlinkedAds.length}] ${ad.id}: could not read creative: ${err.message}`);
        }
        if (!videos.length) {
          if (![...mappingsByKey.values()].some((m) => m.meta_ad_id === ad.id)) {
            await saveRow(ad, { videoId: null, creativeId: adCreative?.creative?.id || null }, { error: 'No video in this Meta ad (image / carousel).' });
          }
          continue;
        }
      }
      console.log(`[${adCount}/${unlinkedAds.length}] Meta ad ${ad.id} ("${ad.name}") - ${videos.length} video(s)`);
      for (const video of videos) {
        const key = ['meta', ad.id, 'creative', video.creativeId || 'primary', 'video', video.videoId].join(':');
        const existing = mappingsByKey.get(key);
        if (existing && (existing.transcript || (existing.transcript_status === 'failed' && !retryFailed))) continue;
        let extracted = null;
        const stored = storedVideos.find((v) => v.adId === ad.id && (v.videoId === video.videoId || v.id === video.videoId));
        if (stored?.url) {
          try { extracted = { ...(await transcribeVideoSource(stored.url)), error: null }; } catch { /* expired signed URL: use a fresh one below */ }
        }
        if (!extracted) {
          if (!adCreative) adCreative = await getMetaAdCreative(ad.id, metaToken).catch(() => null);
          const source = await getVideoSource(video.videoId, adCreative?.creative, metaToken);
          if (!source.source) extracted = { transcript: null, error: `Could not read Meta video ${video.videoId}: ${source.error || 'no source URL returned'}` };
          else {
            try { extracted = { ...(await transcribeVideoSource(source.source)), error: null }; }
            catch (err) { extracted = { transcript: null, error: err.message }; }
          }
        }
        await saveRow(ad, video, extracted);
        if (extracted.transcript) newlyTranscribed++;
      }
    }
  }

  // Compile one record per VIDEO (creative) for the target ads.
  console.log('\nCompiling per-creative transcript records...');
  const compiledRecords = [];
  let availableCount = 0;
  let emptyCount = 0;
  for (const ad of unlinkedAds) {
    const scopedVideos = new Set((videosByAd.get(ad.id) || []).map((v) => v.videoId));
    const rows = [...mappingsByKey.values()].filter((m) => m.meta_ad_id === ad.id && (!scopedVideos.size || scopedVideos.has(m.meta_video_id)));
    if (!rows.length) {
      emptyCount++;
      compiledRecords.push({ meta_ad_id: ad.id, mapping_key: null, meta_ad_name: ad.name || '', spend: Number(ad.spend || 0), status: 'not_transcribed', transcript: null, video_count: 0 });
      continue;
    }
    for (const m of rows) {
      const hasTranscript = Boolean(m.transcript && m.transcript.trim().length > 0);
      if (hasTranscript) availableCount++; else emptyCount++;
      compiledRecords.push({
        meta_ad_id: ad.id,
        meta_ad_name: ad.name || '',
        spend: Number(ad.spend || 0),
        status: hasTranscript ? 'transcript_available' : m.transcript_status || 'not_transcribed',
        language: m.transcript_language || null,
        language_confidence: m.transcript_language_confidence || null,
        meta_creative_id: m.meta_creative_id || null,
        meta_video_id: m.meta_video_id || null,
        asset_label: labelByVideo.get(`${ad.id}:${m.meta_video_id}`) || null,
        video_count: rows.length,
        transcript: m.transcript || null,
        word_count: m.transcript ? m.transcript.split(/\s+/).filter(Boolean).length : 0,
        transcript_error: m.transcript_error || null,
        previously_matched_ad_id: m.matched_ad_id || null,
        mapping_key: m.mapping_key || null
      });
    }
  }

  // Remove un-reviewed AI rows outside the priority scope so the audit table only shows creatives we actually attribute.
  if (args.includes('--prune')) {
    const keep = new Set(compiledRecords.map((r) => r.mapping_key).filter(Boolean));
    const stale = [...mappingsByKey.values()].filter((m) => !keep.has(m.mapping_key) && m.transcript_source !== 'exact_creative_id' && (m.review_status || 'pending') === 'pending');
    for (let i = 0; i < stale.length; i += 100) {
      const { error } = await supabase.from('meta_ad_transcript_mappings').delete().in('mapping_key', stale.slice(i, i + 100).map((m) => m.mapping_key));
      if (error) console.log(`Prune error: ${error.message}`);
    }
    console.log(`Pruned ${stale.length} un-reviewed rows outside the priority scope.`);
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
