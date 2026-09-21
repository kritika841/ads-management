const crypto = require("node:crypto");
const path = require("node:path");
const vm = require("node:vm");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

const GRAPH_VERSION = "v23.0";
const MAX_VIDEO_BYTES = Number(process.env.META_AD_TRANSCRIPT_MAX_BYTES || 250 * 1024 * 1024);
const DEEPGRAM_MODEL = process.env.DEEPGRAM_TRANSCRIPT_MODEL || "nova-3";

const STOP_WORDS = new Set([
  "the", "and", "for", "you", "your", "with", "this", "that", "from", "are", "our", "have", "has", "was", "were", "but", "not", "can", "will", "just", "all", "get", "got", "into", "out", "its", "it's", "is", "to", "of", "in", "on", "a", "an", "or", "as", "at", "by", "be", "we", "it"
]);

function normalizeTranscript(value) {
  return (value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(value) {
  return new Set(normalizeTranscript(value).split(" ").filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

function matchTranscriptToScripts(transcript, candidates, minimumScore = 0.28) {
  const transcriptTokens = tokens(transcript);
  if (!transcriptTokens.size || !candidates.length) return { adId: null, score: 0, confidence: "unmatched", matchedTokens: 0, transcriptTokens: 0, scriptTokens: 0 };
  const scored = candidates
    .map((candidate) => {
      const scriptTokens = tokens(candidate.script_text || "");
      const matchedTokens = [...transcriptTokens].filter((token) => scriptTokens.has(token)).length;
      const recall = scriptTokens.size ? matchedTokens / scriptTokens.size : 0;
      const precision = matchedTokens / transcriptTokens.size;
      const score = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
      return { candidate, score, matchedTokens, transcriptTokens: transcriptTokens.size, scriptTokens: scriptTokens.size };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < minimumScore || best.matchedTokens < 3) return { adId: null, score: best?.score || 0, confidence: "unmatched", matchedTokens: best?.matchedTokens || 0, transcriptTokens: best?.transcriptTokens || 0, scriptTokens: best?.scriptTokens || 0 };
  const margin = best.score - (second?.score || 0);
  const confidence = best.score >= 0.72 && margin >= 0.12 ? "high" : best.score >= 0.48 && margin >= 0.08 ? "medium" : "low";
  return { adId: confidence === "high" ? best.candidate.id : null, score: Number(best.score.toFixed(4)), confidence, matchedTokens: best.matchedTokens, transcriptTokens: best.transcriptTokens, scriptTokens: best.scriptTokens };
}

async function graphGet(base, token, params) {
  const url = new URL(base);
  url.searchParams.set("access_token", token);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta returned HTTP ${response.status}`);
  return payload;
}

function findVideoIds(value, found = new Set()) {
  if (!value || typeof value !== "object") return [...found];
  if (typeof value.video_id === "string" && value.video_id) found.add(value.video_id);
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

async function transcribeVideoSource(source) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not configured.");
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", "nova-3");
  url.searchParams.set("language", "multi");
  // Keep the complete spoken track for script matching. In particular, filler_words
  // prevents Deepgram from dropping words such as "um" and "uh". Do not enable any
  // summarization feature here; the stored value must remain a verbatim transcript.
  url.searchParams.set("filler_words", "true");
  url.searchParams.set("diarize", "true");
  url.searchParams.set("utterances", "true");
  url.searchParams.set("words", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("smart_format", "false");
  url.searchParams.set("numerals", "false");
  const transcription = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: source })
  });
  const payload = await transcription.json();
  if (!transcription.ok) throw new Error(payload.err_msg || payload.message || `Deepgram returned HTTP ${transcription.status}.`);
  const alternatives = (payload.results?.channels || [])
    .map((channel) => channel.alternatives?.[0])
    .filter(Boolean);
  const words = alternatives.flatMap((alternative) => alternative.words || []);
  const wordTranscript = words
    .map((word) => word.punctuated_word || word.word)
    .filter(Boolean)
    .join(" ")
    .trim();
  const transcript = (wordTranscript || alternatives.map((alternative) => alternative.transcript || "").join(" ")).trim();
  if (!transcript) throw new Error("Deepgram returned an empty transcript.");
  const channel = payload.results?.channels?.[0] || {};
  const language = channel.detected_language || alternatives.find((alternative) => alternative.detected_language)?.detected_language || [...new Set(words.map((word) => word.language).filter(Boolean))].join(",") || "multi";
  return {
    transcript,
    language,
    languageConfidence: channel.language_confidence ?? alternatives.find((alternative) => alternative.language_confidence != null)?.language_confidence ?? null,
    wordTimings: words.map((word) => ({ word: word.punctuated_word || word.word, start: word.start, end: word.end, confidence: word.confidence, language: word.language ?? null, speaker: word.speaker ?? null }))
  };
}

async function extract(metaAdId, token) {
  const ad = await getMetaAdCreative(metaAdId, token);
  const creativeId = ad.creative?.id || null;
  const videoIds = findVideoIds(ad.creative);
  if (!videoIds.length) return [{ metaAdId, creativeId, videoId: null, transcript: null, error: "No video ID found on this Meta ad creative." }];
  const results = [];
  for (const videoId of videoIds) {
    const video = await getVideoSource(videoId, ad.creative, token);
    if (video.error) results.push({ metaAdId, creativeId, videoId, transcript: null, error: `Could not read Meta video ${videoId}: ${video.error}` });
    else if (!video.source) results.push({ metaAdId, creativeId, videoId, transcript: null, error: "Meta did not return a raw video source URL for this video." });
    else {
      try {
        const transcription = await transcribeVideoSource(video.source);
        results.push({ metaAdId, creativeId, videoId, ...transcription, error: null });
      }
      catch (err) { results.push({ metaAdId, creativeId, videoId, transcript: null, error: err.message }); }
    }
  }
  return results;
}

let pageTokensPromise;

async function getVideoSource(videoId, creative, token) {
  const userVideo = await graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/${videoId}`, token, { fields: "id,source,format" })
    .catch((err) => ({ source: null, error: err.message }));
  if (userVideo.source || userVideo.error) return userVideo;

  const pageId = findPageId(creative);
  if (!pageId) return userVideo;
  const pageToken = (await getPageTokens(token)).get(pageId);
  if (!pageToken) return userVideo;
  return graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/${videoId}`, pageToken, { fields: "id,source,format" })
    .catch((err) => ({ source: null, error: err.message }));
}

async function getPageTokens(token) {
  if (!pageTokensPromise) {
    pageTokensPromise = graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, token, { fields: "id,access_token", limit: "100" })
      .then((payload) => new Map((payload.data || []).filter((page) => page.id && page.access_token).map((page) => [page.id, page.access_token])))
      .catch(() => new Map());
  }
  return pageTokensPromise;
}

function findPageId(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.page_id === "string" && value.page_id) return value.page_id;
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

async function getMetaAdCreative(metaAdId, token) {
  if (process.env.META_AD_ACCOUNT_ID) {
    const account = process.env.META_AD_ACCOUNT_ID.replace(/^act_/, "");
    const payload = await graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/act_${account}/ads`, token, {
      limit: "1",
      filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: [metaAdId] }]),
      fields: "id,creative{id,video_id,object_story_spec,asset_feed_spec}"
    });
    if (payload.data?.[0]) return payload.data[0];
  }
  return graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/${metaAdId}`, token, {
    fields: "id,creative{id,video_id,object_story_spec,asset_feed_spec}"
  });
}

function findStoredMediaUrl(metaAdId, creativeId, videoId) {
  const videos = loadStoredMediaVideos();
  const stored = videos.find((item) =>
    item.adId === metaAdId &&
    (!creativeId || item.creativeId === creativeId || item.id === creativeId) &&
    (!videoId || item.videoId === videoId || item.id === videoId || item.creativeId === creativeId)
  );
  return stored?.url || null;
}

function loadStoredMediaVideos() {
  const file = path.resolve(process.cwd(), "app/live-media-videos.ts");
  try {
    const text = require("node:fs").readFileSync(file, "utf8").replace(/^export const mediaVideos = /, "globalThis.mediaVideos = ");
    const context = {};
    vm.runInNewContext(text, context);
    return Array.isArray(context.mediaVideos) ? context.mediaVideos : [];
  } catch {
    return [];
  }
}

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = Math.min(Math.max(Number(limitArg?.split("=")[1] || 5), 1), 25);
  const retryFailed = process.argv.includes("--retry-failed");
  const cachedOnly = process.argv.includes("--cached-only");
  const allCreatives = process.argv.includes("--all-creatives");
  const reprocessExisting = process.argv.includes("--reprocess-existing");
  const nonExactOnly = process.argv.includes("--non-exact-only");
  const metaIds = process.argv.filter((arg) => /^\d+$/.test(arg));
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN is not configured.");

  const [{ data: scripts, error: scriptsError }, { data: existing, error: existingError }] = await Promise.all([
    supabase.from("ads").select("id,script_text").eq("production_stage", "approved").not("script_text", "is", null),
    supabase.from("meta_ad_transcript_mappings").select("meta_ad_id,transcript_status,transcript_source")
  ]);
  if (scriptsError) throw scriptsError;
  if (existingError) throw existingError;
  const skippedStatuses = new Set(retryFailed ? ["available"] : ["available", "failed"]);
  const exactMatched = new Set((existing || []).filter((row) => row.transcript_source === "exact_creative_id").map((row) => row.meta_ad_id));
  const handled = allCreatives || reprocessExisting ? new Set() : new Set((existing || []).filter((row) => skippedStatuses.has(row.transcript_status)).map((row) => row.meta_ad_id));

  const targetIds = cachedOnly
    ? [...new Set(loadStoredMediaVideos().map((video) => video.adId).filter(Boolean))]
    : nonExactOnly
      ? metaIds
    : reprocessExisting
      ? [...new Set((existing || []).map((row) => row.meta_ad_id).filter(Boolean))]
    : metaIds;
  let query = supabase
    .from("meta_ads")
    .select("id,name,spend")
    .order("spend", { ascending: false })
    .limit(targetIds.length ? targetIds.length : 1000);
  if (targetIds.length) query = query.in("id", targetIds);
  const { data: metaAds, error: metaError } = await query;
  if (metaError) throw metaError;
  const ids = (metaAds || []).map((ad) => ad.id).filter((id) => !nonExactOnly || !exactMatched.has(id)).filter((id) => targetIds.length || !handled.has(id)).filter((id) => reprocessExisting || !handled.has(id)).slice(0, limit);
  console.log(`starting batch size=${ids.length} limit=${limit} cachedOnly=${cachedOnly} reprocessExisting=${reprocessExisting} nonExactOnly=${nonExactOnly}`);

  const rows = [];
  async function recordRow(row) {
    row.mapping_key = ["meta", row.meta_ad_id, "creative", row.meta_creative_id || "primary", "video", row.meta_video_id || "primary"].join(":");
    rows.push(row);
    const { error } = await supabase.from("meta_ad_transcript_mappings").upsert([row], { onConflict: "mapping_key" });
    if (error) throw error;
  }
  for (const metaAdId of ids) {
    process.stdout.write(`processing ${metaAdId}... `);
    const now = new Date().toISOString();
    try {
      const extractedItems = await extract(metaAdId, token);
      for (const extracted of extractedItems) {
      if (!extracted.transcript) {
        await recordRow({
          meta_ad_id: metaAdId,
          transcript: null,
          transcript_hash: null,
          transcript_language: null,
          transcript_language_confidence: null,
          transcript_word_timings: null,
          transcript_source: "meta_graph_deepgram",
          transcript_status: "failed",
          transcript_error: extracted.error,
          meta_creative_id: extracted.creativeId,
          meta_video_id: extracted.videoId,
          matched_ad_id: null,
          match_score: 0,
          match_confidence: "unmatched",
          matched_tokens: 0,
          transcript_token_count: 0,
          script_token_count: 0,
          mapped_at: now
        });
        console.log(`failed: ${extracted.error || "unknown extraction error"}`);
        continue;
      }
      const match = matchTranscriptToScripts(extracted.transcript, scripts || []);
      await recordRow({
        meta_ad_id: metaAdId,
        transcript: extracted.transcript,
        transcript_hash: crypto.createHash("sha256").update(extracted.transcript).digest("hex"),
        transcript_language: extracted.language,
        transcript_language_confidence: extracted.languageConfidence,
        transcript_word_timings: extracted.wordTimings,
        transcript_source: "meta_graph_deepgram",
        transcript_status: "available",
        transcript_error: null,
        meta_creative_id: extracted.creativeId,
        meta_video_id: extracted.videoId,
        // ASR is evidence for manual review only. Never link a Creative
        // Library ad from transcript similarity in this worker.
        matched_ad_id: null,
        match_score: match.score,
        match_confidence: "unmatched",
        matched_tokens: match.matchedTokens,
        transcript_token_count: match.transcriptTokens,
        script_token_count: match.scriptTokens,
        mapped_at: now
      });
      console.log(match.adId ? `matched ${match.confidence}` : "unmatched");
      }
    } catch (err) {
      await recordRow({
        meta_ad_id: metaAdId,
        transcript: null,
        transcript_hash: null,
        transcript_language: null,
        transcript_language_confidence: null,
        transcript_word_timings: null,
        transcript_source: "meta_graph_deepgram",
        transcript_status: "failed",
        transcript_error: err.message,
        meta_creative_id: null,
        meta_video_id: null,
        matched_ad_id: null,
        match_score: 0,
        match_confidence: "unmatched",
        matched_tokens: 0,
        transcript_token_count: 0,
        script_token_count: 0,
        mapped_at: now
      });
      console.log(`failed: ${err.message || "unknown processing error"}`);
    }
  }

  const mapped = rows.filter((row) => row.matched_ad_id).length;
  const failed = rows.filter((row) => row.transcript_status === "failed").length;
  const unmatched = rows.filter((row) => row.transcript_status === "available" && !row.matched_ad_id).length;
  console.log(JSON.stringify({ processed: rows.length, mapped, failed, unmatched }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
