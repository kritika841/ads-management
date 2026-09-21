import { createHash } from "node:crypto";
import { mediaVideos } from "@/app/live-media-videos";
import { matchTranscriptToScripts, type ScriptCandidate } from "@/lib/transcript-matching";

const GRAPH_VERSION = "v23.0";
const MAX_VIDEO_BYTES = Number(process.env.META_AD_TRANSCRIPT_MAX_BYTES || 250 * 1024 * 1024);
const DEEPGRAM_MODEL = process.env.DEEPGRAM_TRANSCRIPT_MODEL || "nova-3";

type MetaError = { message?: string };
type MetaPayload<T> = T & { error?: MetaError };
type MetaAdCreativePayload = {
  id: string;
  creative?: {
    id?: string;
    video_id?: string;
    object_story_spec?: unknown;
    asset_feed_spec?: unknown;
  };
};
type VideoPayload = { id: string; source?: string; format?: { filter?: string; height?: number; width?: number; picture?: string }[] };
type StoredMediaVideo = { adId: string; creativeId?: string; id?: string; videoId?: string; url: string };

export type ExtractedMetaTranscript = {
  metaAdId: string;
  creativeId: string | null;
  videoId: string | null;
  transcript: string | null;
  transcriptHash: string | null;
  error: string | null;
};

export type TranscriptMappingRow = {
  mapping_key: string;
  meta_ad_id: string;
  transcript: string | null;
  transcript_hash: string | null;
  transcript_language: string | null;
  transcript_source: string;
  transcript_status: "available" | "failed";
  transcript_error?: string | null;
  meta_creative_id?: string | null;
  meta_video_id?: string | null;
  matched_ad_id: string | null;
  match_score: number;
  match_confidence: "high" | "medium" | "low" | "unmatched";
  matched_tokens: number;
  transcript_token_count: number;
  script_token_count: number;
  mapped_at: string;
};

export async function extractMetaAdTranscript(metaAdId: string, token: string): Promise<ExtractedMetaTranscript> {
  try {
    const storedUrlOnly = findStoredMediaUrl(metaAdId, null, null);
    if (storedUrlOnly) {
      const transcript = await transcribeVideoSource(storedUrlOnly);
      return {
        metaAdId,
        creativeId: null,
        videoId: null,
        transcript,
        transcriptHash: createHash("sha256").update(transcript).digest("hex"),
        error: null
      };
    }

    const ad = await getMetaAdCreative(metaAdId, token);
    const creativeId = ad.creative?.id ?? null;
    const videoId = findVideoId(ad.creative) ?? null;
    if (!videoId) return { metaAdId, creativeId, videoId: null, transcript: null, transcriptHash: null, error: "No video ID found on this Meta ad creative." };

    const storedUrl = findStoredMediaUrl(metaAdId, creativeId, videoId);
    if (storedUrl) {
      const transcript = await transcribeVideoSource(storedUrl);
      return {
        metaAdId,
        creativeId,
        videoId,
        transcript,
        transcriptHash: createHash("sha256").update(transcript).digest("hex"),
        error: null
      };
    }

    const video = await getVideoSource(videoId, ad.creative, token);
    if (!video.source) return { metaAdId, creativeId, videoId, transcript: null, transcriptHash: null, error: "Meta did not return a raw video source URL for this video." };

    const transcript = await transcribeVideoSource(video.source);
    return {
      metaAdId,
      creativeId,
      videoId,
      transcript,
      transcriptHash: createHash("sha256").update(transcript).digest("hex"),
      error: null
    };
  } catch (cause) {
    return { metaAdId, creativeId: null, videoId: null, transcript: null, transcriptHash: null, error: cause instanceof Error ? cause.message : "Transcript extraction failed." };
  }
}

let pageTokensPromise: Promise<Map<string, string>> | null = null;

async function getVideoSource(videoId: string, creative: MetaAdCreativePayload["creative"], token: string) {
  const userVideo = await graphGet<VideoPayload>(`https://graph.facebook.com/${GRAPH_VERSION}/${videoId}`, token, {
    fields: "id,source,format"
  }).catch((cause) => {
    const message = cause instanceof Error ? cause.message : "Meta did not allow video source access.";
    return { id: videoId, source: undefined, error: message };
  });
  if (userVideo.source || "error" in userVideo) return userVideo;

  const pageId = findPageId(creative);
  if (!pageId) return userVideo;
  const pageToken = (await getPageTokens(token)).get(pageId);
  if (!pageToken) return userVideo;
  return graphGet<VideoPayload>(`https://graph.facebook.com/${GRAPH_VERSION}/${videoId}`, pageToken, {
    fields: "id,source,format"
  }).catch(() => userVideo);
}

async function getPageTokens(token: string) {
  if (!pageTokensPromise) {
    pageTokensPromise = graphGet<{ data?: { id?: string; access_token?: string }[] }>(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, token, {
      fields: "id,access_token",
      limit: "100"
    }).then((payload) => new Map(
      (payload.data ?? [])
        .filter((page): page is { id: string; access_token: string } => Boolean(page.id && page.access_token))
        .map((page) => [page.id, page.access_token])
    )).catch(() => new Map());
  }
  return pageTokensPromise;
}

function findPageId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if ("page_id" in value && typeof value.page_id === "string" && value.page_id) return value.page_id;
  if (Array.isArray(value)) {
    for (const item of value) {
      const pageId = findPageId(item);
      if (pageId) return pageId;
    }
    return null;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const pageId = findPageId(child);
    if (pageId) return pageId;
  }
  return null;
}

function findStoredMediaUrl(metaAdId: string, creativeId: string | null, videoId: string | null) {
  const stored = (mediaVideos as StoredMediaVideo[]).find((item) =>
    item.adId === metaAdId &&
    (!creativeId || item.creativeId === creativeId || item.id === creativeId) &&
    (!videoId || item.videoId === videoId || item.id === videoId || item.creativeId === creativeId)
  );
  return stored?.url ?? null;
}

async function getMetaAdCreative(metaAdId: string, token: string) {
  const rawAccountId = process.env.META_AD_ACCOUNT_ID;
  if (rawAccountId) {
    const accountId = rawAccountId.replace(/^act_/, "");
    const payload = await graphGet<{ data?: MetaAdCreativePayload[] }>(`https://graph.facebook.com/${GRAPH_VERSION}/act_${accountId}/ads`, token, {
      limit: "1",
      filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: [metaAdId] }]),
      fields: "id,creative{id,video_id,object_story_spec,asset_feed_spec}"
    });
    const ad = payload.data?.[0];
    if (ad) return ad;
  }
  return graphGet<MetaAdCreativePayload>(`https://graph.facebook.com/${GRAPH_VERSION}/${metaAdId}`, token, {
    fields: "id,creative{id,video_id,object_story_spec,asset_feed_spec}"
  });
}

export function buildTranscriptMappingRow(extracted: ExtractedMetaTranscript, candidates: ScriptCandidate[], now = new Date().toISOString()): TranscriptMappingRow {
  if (!extracted.transcript) {
    return {
      mapping_key: buildTranscriptMappingKey(extracted.metaAdId, extracted.creativeId, extracted.videoId),
      meta_ad_id: extracted.metaAdId,
      transcript: null,
      transcript_hash: null,
      transcript_language: null,
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
    };
  }

  const match = matchTranscriptToScripts(extracted.transcript, candidates);
  return {
    mapping_key: buildTranscriptMappingKey(extracted.metaAdId, extracted.creativeId, extracted.videoId),
    meta_ad_id: extracted.metaAdId,
    transcript: extracted.transcript,
    transcript_hash: extracted.transcriptHash,
    transcript_language: null,
    transcript_source: "meta_graph_deepgram",
    transcript_status: "available",
    transcript_error: null,
    meta_creative_id: extracted.creativeId,
    meta_video_id: extracted.videoId,
    matched_ad_id: match.adId,
    match_score: match.score,
    match_confidence: match.confidence,
    matched_tokens: match.matchedTokens,
    transcript_token_count: match.transcriptTokens,
    script_token_count: match.scriptTokens,
    mapped_at: now
  };
}

export function buildTranscriptMappingKey(metaAdId: string, creativeId: string | null, videoId: string | null) {
  return ["meta", metaAdId, "creative", creativeId ?? "primary", "video", videoId ?? "primary"].join(":");
}

async function transcribeVideoSource(source: string) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not configured.");
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", DEEPGRAM_MODEL);
  // Preserve the complete spoken track for reliable Creative Library matching.
  // Filler words are intentionally retained; this endpoint must not summarize.
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
  const payload = await transcription.json() as {
    err_msg?: string;
    message?: string;
    results?: { channels?: { alternatives?: { transcript?: string; words?: { word?: string; punctuated_word?: string }[] }[] }[] };
  };
  if (!transcription.ok) throw new Error(payload.err_msg ?? payload.message ?? `Deepgram returned HTTP ${transcription.status}.`);
  const alternatives = (payload.results?.channels ?? [])
    .map((channel) => channel.alternatives?.[0])
    .filter((alternative): alternative is { transcript?: string; words?: { word?: string; punctuated_word?: string }[] } => Boolean(alternative));
  const wordTranscript = alternatives
    .flatMap((alternative) => alternative.words ?? [])
    .map((word) => word.punctuated_word ?? word.word)
    .filter((word): word is string => Boolean(word))
    .join(" ")
    .trim();
  const transcript = (wordTranscript || alternatives.map((alternative) => alternative.transcript ?? "").join(" ")).trim();
  if (!transcript) throw new Error("Deepgram returned an empty transcript.");
  return transcript;
}

async function graphGet<T>(base: string, token: string, params: Record<string, string>) {
  const url = new URL(base);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json() as MetaPayload<T>;
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `Meta returned HTTP ${response.status}.`);
  return payload as T;
}

function findVideoId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if ("video_id" in value && typeof value.video_id === "string" && value.video_id) return value.video_id;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findVideoId(item);
      if (match) return match;
    }
    return null;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const match = findVideoId(child);
    if (match) return match;
  }
  return null;
}
