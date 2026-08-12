import { pipeline } from '@xenova/transformers';

const RAW_CLIP_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const RAW_CLIP_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

let embedderPromise = null;

export class DailyQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DailyQuotaError';
  }
}

export function getRawClipEmbeddingModel() {
  return RAW_CLIP_EMBEDDING_MODEL;
}

export function getRawClipGeminiEmbeddingModel() {
  return RAW_CLIP_GEMINI_EMBEDDING_MODEL;
}

export function getRawClipEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', RAW_CLIP_EMBEDDING_MODEL);
  }
  return embedderPromise;
}

export async function embedRawClipText(text) {
  const embedder = await getRawClipEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export function buildSegmentEmbedInput(
  visualDescription,
  spokenText,
  environmentDescription,
  onScreenText,
  peopleDescription
) {
  const parts = [visualDescription || ''];
  if (environmentDescription) parts.push(`Environment: ${environmentDescription}`);
  if (onScreenText) parts.push(`Text: ${onScreenText}`);
  if (peopleDescription) parts.push(`People: ${peopleDescription}`);
  if (spokenText) parts.push(`Spoken: ${spokenText}`);
  return parts.join(' ');
}

let geminiApiKeys = null;
let currentKeyIndex = 0;

function getGeminiApiKeys() {
  if (geminiApiKeys) return geminiApiKeys;
  const envKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_EMBEDDING_API_KEY || process.env.GEMINI_API_KEY;
  if (!envKeys) return [];
  geminiApiKeys = envKeys.split(',').map(k => k.trim()).filter(Boolean);
  return geminiApiKeys;
}

export function getCurrentGeminiApiKey() {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) return null;
  return keys[currentKeyIndex % keys.length];
}

export function rotateGeminiApiKey() {
  const keys = getGeminiApiKeys();
  if (keys.length <= 1) return false;
  currentKeyIndex++;
  if (currentKeyIndex >= keys.length) return false; // all keys exhausted
  console.log(`[QUOTA] Rotating to Gemini API key ${currentKeyIndex + 1} of ${keys.length}`);
  return true;
}

export async function embedWithGemini(text) {
  return retryGeminiCall(async () => {
    const { GoogleGenAI } = await import('@google/genai');
    const apiKey = getCurrentGeminiApiKey();
    if (!apiKey) {
      throw new Error('Gemini embedding API key is not configured.');
    }

    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.embedContent({
      model: RAW_CLIP_GEMINI_EMBEDDING_MODEL,
      contents: text,
    });

    const values = result?.embeddings?.[0]?.values;
    if (!values) {
      throw new Error('Gemini embedding response did not contain embedding values.');
    }

    const embedding = Array.from(values);
    if (embedding.length !== 3072) {
      throw new Error(`Expected 3072-dimensional Gemini embeddings, got ${embedding.length}`);
    }

    return embedding;
  });
}

export function groupSegmentMatchesByClip(matches, limit = 15) {
  const bestByClip = new Map();

  for (const match of matches || []) {
    const normalized = {
      raw_clip_id: match.raw_clip_id,
      ad_id: match.ad_id,
      segment_id: match.segment_id,
      segment_index: Number(match.segment_index),
      start_seconds: Number(match.start_seconds),
      end_seconds: Number(match.end_seconds),
      visual_description: match.visual_description,
      spoken_text: match.spoken_text || '',
      on_screen_text: match.on_screen_text || '',
      environment_description: match.environment_description || '',
      people_description: match.people_description || '',
      similarity: Number(match.similarity),
    };

    const groupingKey = normalized.raw_clip_id || normalized.ad_id;
    const current = bestByClip.get(groupingKey);
    if (!current || normalized.similarity > current.similarity) {
      bestByClip.set(groupingKey, normalized);
    }
  }

  return Array.from(bestByClip.values())
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit);
}

export function isRateLimitError(err) {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota');
}

export function isDailyQuotaError(err) {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('per day') || msg.includes('daily') || msg.includes('free_tier_requests') || (msg.includes('quota exceeded') && msg.includes('free tier'));
}

export async function retryGeminiCall(task, attempt = 1) {
  try {
    return await task();
  } catch (err) {
    if (err instanceof DailyQuotaError || isDailyQuotaError(err)) {
      if (rotateGeminiApiKey()) {
        return retryGeminiCall(task, 1);
      }
      throw new DailyQuotaError(err?.message || 'Daily quota exhausted on all keys');
    }
    if (isRateLimitError(err) && attempt < 3) {
      const backoffMs = [2000, 5000, 10000][attempt - 1] || 10000;
      await sleep(backoffMs);
      return retryGeminiCall(task, attempt + 1);
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
