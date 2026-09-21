/**
 * Robust Multilingual Semantic & Multi-Anchor Transcript Matcher
 * 
 * Handles:
 * - Devanagari Hindi to Romanized Hinglish phonetic mapping
 * - Spelling variations (khushboo vs khushbu, dhuand vs dhuan vs smoke)
 * - Commercial numbers and offer normalization (₹999, nau sau ninyanve, 3 boxes, teen dabbe, B2G1)
 * - Narrative anchor triangulation (Papa, Wife, Janmashtami, Whitewash)
 * - Margin validation between top candidates to eliminate false positives
 */

export type ScriptCandidate = {
  id: string;
  name?: string | null;
  script_text: string | null;
  product_name?: string | null;
  hook?: string | null;
};

export type SemanticMatchResult = {
  adId: string | null;
  creativeName: string | null;
  score: number;
  confidence: "high" | "medium" | "low" | "unmatched";
  matchedTokens: number;
  transcriptTokens: number;
  scriptTokens: number;
  rationale: string;
  anchorsMatched: string[];
};

const devanagariToLatinMap: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ँ': 'n', 'ः': 'h', '्': '',
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au'
};

export function transliterateDevanagari(text: string): string {
  if (!text) return '';
  let out = '';
  for (const char of text) {
    out += devanagariToLatinMap[char] ?? char;
  }
  return out.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Standardize common phonetic spellings and slang across Hindi and English
 */
export function normalizeSpelling(text: string): string {
  return text
    .toLowerCase()
    // Fragrance / scent
    .replace(/khushboo|khushbu|khusboo|khusbu/g, 'khushbu')
    .replace(/agarbatti|agarbathi|agarbati|incense/g, 'agarbatti')
    // Smoke
    .replace(/dhuaand|dhuand|dhuaan|dhuan/g, 'dhuan')
    // Containers / boxes
    .replace(/dabbe|dibbe|dabba|dibba|boxes|box/g, 'dabbe')
    // Numbers & commercial offers
    .replace(/nau sau ninyanve|nine point nine nine|nine ninety nine|999|₹999/g, 'num999')
    .replace(/buy two get one free|buy 2 get 1 free|buy too get one free|b2g1/g, 'b2g1')
    .replace(/teen|three|tin/g, 'num3')
    .replace(/ceramic stand|ceramic stand free/g, 'ceramicstand')
    .replace(/bambooless|bamboo less/g, 'bambooless')
    .replace(/charcoal free|charcoal-free|charcoalfree/g, 'charcoalfree')
    // Brand name
    .replace(/satmi|satmya|satmiya/g, 'satmi')
    // Whitewash / paint
    .replace(/white wash|whitewash|paint ki smell/g, 'whitewash')
    // Characters
    .replace(/papa ne dekha|papa bole/g, 'papadialogue')
    .replace(/mehmaan|mehman/g, 'mehman')
    .replace(/janmashtami|krishna ji|krishna bhagwan/g, 'janmashtami')
    // Clean spacing
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'we', 'with', 'you', 'your',
  'hai', 'hain', 'ki', 'ke', 'ka', 'ko', 'se', 'mein', 'par', 'aur', 'toh', 'bhi',
  'yeh', 'woh', 'kya', 'kyun', 'kuch', 'kar', 'raha', 'rahe', 'tha', 'thi', 'the'
]);

function extractTokens(text: string): Set<string> {
  const normalized = normalizeSpelling(transliterateDevanagari(text));
  const words = normalized.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Identify presence of key commercial & narrative anchors
 */
function identifyAnchors(text: string): Set<string> {
  const norm = normalizeSpelling(transliterateDevanagari(text));
  const found = new Set<string>();

  if (norm.includes('num999')) found.add('offer_999');
  if (norm.includes('b2g1')) found.add('offer_b2g1');
  if (norm.includes('pack of') || (norm.includes('num3') && (norm.includes('dabbe') || norm.includes('pack')))) found.add('pack_of_3');
  if (norm.includes('ceramicstand')) found.add('ceramic_stand');
  if (norm.includes('bambooless')) found.add('bambooless');
  if (norm.includes('charcoalfree')) found.add('charcoalfree');
  if (norm.includes('chandan')) found.add('aroma_chandan');
  if (norm.includes('gulab')) found.add('aroma_gulab');
  if (norm.includes('oudh')) found.add('aroma_oudh');
  if (norm.includes('jatamansi')) found.add('aroma_jatamansi');
  if (norm.includes('whitewash')) found.add('angle_whitewash');
  if (norm.includes('papadialogue') || (norm.includes('papa') && norm.includes('dabbe'))) found.add('angle_papa');
  if (norm.includes('janmashtami')) found.add('angle_janmashtami');
  if (norm.includes('mehman')) found.add('angle_mehman');
  if (norm.includes('relationship') || norm.includes('compromise')) found.add('angle_relationship');

  return found;
}

export function matchTranscriptSemantically(
  transcript: string,
  candidates: ScriptCandidate[]
): SemanticMatchResult {
  if (!transcript || !transcript.trim() || !candidates.length) {
    return {
      adId: null,
      creativeName: null,
      score: 0,
      confidence: "unmatched",
      matchedTokens: 0,
      transcriptTokens: 0,
      scriptTokens: 0,
      rationale: "No transcript provided or candidate pool empty.",
      anchorsMatched: []
    };
  }

  const tTokens = extractTokens(transcript);
  const tAnchors = identifyAnchors(transcript);

  if (tTokens.size < 3) {
    return {
      adId: null,
      creativeName: null,
      score: 0,
      confidence: "unmatched",
      matchedTokens: 0,
      transcriptTokens: tTokens.size,
      scriptTokens: 0,
      rationale: "Transcript too short to establish reliable identity.",
      anchorsMatched: []
    };
  }

  // Extract first 150 chars of transcript as Hook
  const tHookTokens = extractTokens(transcript.slice(0, 150));

  const scored = candidates
    .filter(c => c.script_text && c.script_text.trim().length > 10)
    .map((candidate) => {
      const sTokens = extractTokens(candidate.script_text!);
      const sAnchors = identifyAnchors(candidate.script_text!);

      // Calculate shared token overlap
      let sharedCount = 0;
      for (const t of tTokens) {
        if (sTokens.has(t)) sharedCount++;
      }

      // Calculate shared anchors
      const sharedAnchors: string[] = [];
      for (const a of tAnchors) {
        if (sAnchors.has(a)) sharedAnchors.push(a);
      }

      // Calculate Hook token match
      const sHookText = candidate.hook || candidate.script_text!.slice(0, 150);
      const sHookTokens = extractTokens(sHookText);
      let hookSharedCount = 0;
      for (const h of tHookTokens) {
        if (sHookTokens.has(h)) hookSharedCount++;
      }
      const hookScore = tHookTokens.size ? hookSharedCount / tHookTokens.size : 0;

      // Base Precision & Recall
      const precision = sharedCount / tTokens.size;
      const recall = sTokens.size ? sharedCount / sTokens.size : 0;
      const baseF1 = (precision + recall > 0) ? (2 * precision * recall) / (precision + recall) : 0;

      // Composite Multi-Anchor Score
      let finalScore = baseF1 * 0.6 + hookScore * 0.25;
      if (sharedAnchors.length >= 2) {
        finalScore += Math.min(sharedAnchors.length * 0.05, 0.15);
      }

      finalScore = Math.min(Math.max(finalScore, 0), 1);

      return {
        candidate,
        score: Number(finalScore.toFixed(4)),
        baseF1: Number(baseF1.toFixed(4)),
        hookScore: Number(hookScore.toFixed(4)),
        sharedTokens: sharedCount,
        transcriptTokens: tTokens.size,
        scriptTokens: sTokens.size,
        sharedAnchors
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  if (!best || best.score < 0.40) {
    return {
      adId: null,
      creativeName: null,
      score: best?.score || 0,
      confidence: "unmatched",
      matchedTokens: best?.sharedTokens || 0,
      transcriptTokens: tTokens.size,
      scriptTokens: best?.scriptTokens || 0,
      rationale: `Best candidate (${best?.candidate.name || 'none'}) scored ${(best?.score ?? 0) * 100}%, which is below the matching threshold.`,
      anchorsMatched: []
    };
  }

  const margin = Number((best.score - (second?.score || 0)).toFixed(4));
  const hasStrongAnchors = best.sharedAnchors.length >= 2 || (best.sharedAnchors.length >= 1 && best.hookScore >= 0.4);

  let confidence: "high" | "medium" | "low" | "unmatched" = "low";
  let rationale = "";

  if ((best.score >= 0.65 && margin >= 0.05 && hasStrongAnchors) || (best.sharedAnchors.length >= 3 && margin >= 0.15)) {
    confidence = "high";
    rationale = `High confidence (${(best.score * 100).toFixed(1)}%, margin: +${(margin * 100).toFixed(1)}%). Corresponds to ${best.candidate.name} ("${best.candidate.product_name || 'Product'}"). Anchors matched: [${best.sharedAnchors.join(', ')}].`;
  } else if ((best.score >= 0.50 && margin >= 0.04) || best.sharedAnchors.length >= 2) {
    confidence = "medium";
    rationale = `Moderate match (${(best.score * 100).toFixed(1)}%, margin: +${(margin * 100).toFixed(1)}%). Likely matches ${best.candidate.name}. Anchors matched: [${best.sharedAnchors.join(', ')}]. Suggested for review.`;
  } else {
    confidence = "low";
    rationale = `Candidate ${best.candidate.name} is closest (${(best.score * 100).toFixed(1)}%), but margin (+${(margin * 100).toFixed(1)}%) or anchor evidence is narrow.`;
  }

  return {
    adId: confidence === "high" ? best.candidate.id : null,
    creativeName: best.candidate.name || null,
    score: best.score,
    confidence,
    matchedTokens: best.sharedTokens,
    transcriptTokens: best.transcriptTokens,
    scriptTokens: best.scriptTokens,
    rationale,
    anchorsMatched: best.sharedAnchors
  };
}
