export type ScriptCandidate = {
  id: string;
  script_text: string | null;
};

export type TranscriptMatch = {
  adId: string | null;
  score: number;
  confidence: "high" | "medium" | "low" | "unmatched";
  matchedTokens: number;
  transcriptTokens: number;
  scriptTokens: number;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it",
  "of", "on", "or", "that", "the", "this", "to", "was", "we", "with", "you", "your"
]);

export function normalizeTranscript(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined) {
  return new Set(normalizeTranscript(value).split(" ").filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

function similarity(transcript: string, script: string) {
  const transcriptTokens = tokens(transcript);
  const scriptTokens = tokens(script);
  if (!transcriptTokens.size || !scriptTokens.size) return { score: 0, matchedTokens: 0, transcriptTokens: transcriptTokens.size, scriptTokens: scriptTokens.size };
  const matchedTokens = [...transcriptTokens].filter((token) => scriptTokens.has(token)).length;
  const recall = matchedTokens / transcriptTokens.size;
  const precision = matchedTokens / scriptTokens.size;
  const score = (2 * recall * precision) / (recall + precision);
  return { score, matchedTokens, transcriptTokens: transcriptTokens.size, scriptTokens: scriptTokens.size };
}

export function matchTranscriptToScripts(transcript: string, candidates: ScriptCandidate[], minimumScore = 0.28): TranscriptMatch {
  if (!normalizeTranscript(transcript) || !candidates.length) return { adId: null, score: 0, confidence: "unmatched", matchedTokens: 0, transcriptTokens: 0, scriptTokens: 0 };
  const ranked = candidates
    .map((candidate) => ({ candidate, ...similarity(transcript, candidate.script_text ?? "") }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < minimumScore || best.matchedTokens < 3) return { adId: null, score: best?.score ?? 0, confidence: "unmatched", matchedTokens: best?.matchedTokens ?? 0, transcriptTokens: best?.transcriptTokens ?? 0, scriptTokens: best?.scriptTokens ?? 0 };
  const margin = best.score - (ranked[1]?.score ?? 0);
  const confidence = best.score >= 0.72 && margin >= 0.12 ? "high" : best.score >= 0.48 && margin >= 0.08 ? "medium" : "low";
  // A transcript may only link to a Creative Library item when the evidence is
  // both strong and clearly better than the next approved script. Everything
  // else remains visible for review without creating an attribution.
  return { adId: confidence === "high" ? best.candidate.id : null, score: Number(best.score.toFixed(4)), confidence, matchedTokens: best.matchedTokens, transcriptTokens: best.transcriptTokens, scriptTokens: best.scriptTokens };
}
