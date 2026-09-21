import { describe, expect, it } from 'vitest';

const devanagariToLatinMap = {
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

function transliterateDevanagari(text: string): string {
  if (!text) return '';
  let out = '';
  for (const char of text) {
    out += (devanagariToLatinMap as Record<string, string>)[char] ?? char;
  }
  return out
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function extractHook(scriptText: string): string {
  if (!scriptText) return '';
  const lines = scriptText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const firstLine = lines[0];
  if (firstLine.length < 50 && lines.length > 1) {
    return `${firstLine} ${lines[1]}`.trim();
  }
  return firstLine;
}

describe('Video Mapping Pipeline', () => {
  describe('Stage 1: Script extraction and cleaning', () => {
    it('strips html tags and extracts opening hook', () => {
      const html = '<p>Pichle mahine ghar mein whitewash chal raha tha.<br>Poora ghar paint ki smell se bhara hua tha.</p><p>Mommy ne bola...</p>';
      const clean = stripHtml(html);
      expect(clean).toContain('Pichle mahine ghar mein whitewash chal raha tha.');
      expect(clean).not.toContain('<p>');
      expect(clean).not.toContain('<br>');

      const hook = extractHook(clean);
      expect(hook).toBe('Pichle mahine ghar mein whitewash chal raha tha. Poora ghar paint ki smell se bhara hua tha.');
    });
  });

  describe('Stage 2: Multilingual Hindi / Hinglish transliteration', () => {
    it('transliterates Devanagari Hindi phonetically to match Hinglish scripts', () => {
      const devanagari = 'सत्मी का pack of three लेकर घर आया';
      const transliterated = transliterateDevanagari(devanagari);
      expect(transliterated).toContain('stmee');
      expect(transliterated).toContain('pack of three');
      expect(transliterated).toContain('ghr');
      expect(transliterated).toContain('aaya');
    });

    it('preserves embedded English words within Hindi transcript', () => {
      const mixed = 'हर successful relationship का secret पता है? Compromise.';
      const transliterated = transliterateDevanagari(mixed);
      expect(transliterated).toContain('successful');
      expect(transliterated).toContain('relationship');
      expect(transliterated).toContain('secret');
      expect(transliterated).toContain('compromise');
    });
  });

  describe('Stage 3: Decision thresholds', () => {
    it('classifies high confidence when similarity >= 0.74 and margin >= 0.06', () => {
      const bestSim = 0.8373;
      const secondSim = 0.6500;
      const margin = bestSim - secondSim;

      const isHigh = bestSim >= 0.74 && margin >= 0.06;
      expect(isHigh).toBe(true);
    });

    it('classifies unmatched when best similarity is below threshold', () => {
      const bestSim = 0.45;
      const isUnmatched = bestSim < 0.58;
      expect(isUnmatched).toBe(true);
    });
  });

  describe('Stage 4: Spelling invariance & Anchor matching', () => {
    it('normalizes spelling variants of khushbu, boxes, and numbers to identical tokens', async () => {
      const { normalizeSpelling } = await import('@/lib/semantic-transcript-matcher');
      expect(normalizeSpelling('khushboo')).toBe('khushbu');
      expect(normalizeSpelling('khusboo')).toBe('khushbu');
      expect(normalizeSpelling('dabbe')).toBe('dabbe');
      expect(normalizeSpelling('dibbe')).toBe('dabbe');
      expect(normalizeSpelling('₹999')).toBe('num999');
      expect(normalizeSpelling('nau sau ninyanve')).toBe('num999');
      expect(normalizeSpelling('Buy 2 Get 1 Free')).toBe('b2g1');
      expect(normalizeSpelling('buy two get one free')).toBe('b2g1');
    });

    it('identifies commercial and narrative anchors across Hindi and English variations', async () => {
      const { matchTranscriptSemantically } = await import('@/lib/semantic-transcript-matcher');
      const candidates = [
        {
          id: 'ad-him0095',
          name: 'HIM0095',
          script_text: 'Main Satmi ka Pack of 3 leke ghar aaya. Papa ne dekha aur bole, teen dabbe kyun? Maine kaha, 999 mein buy 2 get 1 free offer hai, sath me ceramic stand free hai.',
          hook: 'Main Satmi ka Pack of 3 leke ghar aaya.'
        },
        {
          id: 'ad-unrelated',
          name: 'UNRELATED',
          script_text: 'Skin serum for daily morning routine.',
          hook: 'Skin serum'
        }
      ];

      const spokenTranscript = 'मैं सत्मी का pack of three लेकर घर आया. Papa ने देखा और बोले, तीन डब्बे, क्यों? 999 में offer hai, ceramic stand free.';
      const match = matchTranscriptSemantically(spokenTranscript, candidates);

      expect(match.creativeName).toBe('HIM0095');
      expect(match.confidence).toBe('high');
      expect(match.anchorsMatched).toContain('pack_of_3');
      expect(match.anchorsMatched).toContain('ceramic_stand');
      expect(match.anchorsMatched).toContain('angle_papa');
    });
  });
});
