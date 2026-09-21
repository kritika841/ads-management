import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from '@xenova/transformers';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

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

function transliterateDevanagari(text) {
  if (!text) return '';
  let out = '';
  for (const char of text) {
    out += devanagariToLatinMap[char] ?? char;
  }
  return out
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

function extractKeywords(text) {
  const clean = text.toLowerCase().replace(/[^a-z0-9]/g, ' ');
  const words = clean.split(/\s+/).filter(w => w.length > 3);
  return new Set(words);
}

async function main() {
  const args = process.argv.slice(2);
  const applyDb = args.includes('--apply');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

  console.log('=== AI Semantic One-Shot Video Mapping Engine ===\n');

  const dataDir = path.resolve(process.cwd(), 'data');
  const scriptsPath = path.join(dataDir, 'creative-library-scripts-expanded.json');
  const transcriptsPath = path.join(dataDir, 'unlinked-meta-ad-transcripts.json');

  if (!fs.existsSync(scriptsPath) || !fs.existsSync(transcriptsPath)) {
    console.error('Missing input files. Please ensure Stage 1 and Stage 2 have run:');
    console.error(`- Scripts: ${scriptsPath}`);
    console.error(`- Transcripts: ${transcriptsPath}`);
    process.exit(1);
  }

  const allScripts = JSON.parse(fs.readFileSync(scriptsPath, 'utf8')).filter(s => s.has_script && s.script_text);
  const allTranscripts = JSON.parse(fs.readFileSync(transcriptsPath, 'utf8'));
  const availableTranscripts = allTranscripts.filter(t => t.transcript && t.transcript.trim().length > 10);

  console.log(`Loaded ${allScripts.length} Creative Library scripts with text.`);
  console.log(`Loaded ${allTranscripts.length} total unlinked Meta ad records (${availableTranscripts.length} with available transcripts).\n`);

  console.log('Initializing multilingual semantic transformer pipeline (@xenova/transformers)...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  // Cache or compute script embeddings
  const embeddingsCachePath = path.join(dataDir, 'creative-script-embeddings.cache.json');
  let scriptEmbeddings = [];

  if (fs.existsSync(embeddingsCachePath)) {
    try {
      console.log('Loading precomputed script embeddings from cache...');
      scriptEmbeddings = JSON.parse(fs.readFileSync(embeddingsCachePath, 'utf8'));
      if (scriptEmbeddings.length !== allScripts.length) {
        console.log('Cache size mismatch, recomputing...');
        scriptEmbeddings = [];
      }
    } catch {
      scriptEmbeddings = [];
    }
  }

  if (!scriptEmbeddings.length) {
    console.log(`Computing embeddings for ${allScripts.length} scripts in Creative Library...`);
    const startTime = Date.now();
    for (let i = 0; i < allScripts.length; i++) {
      const script = allScripts[i];
      if ((i + 1) % 50 === 0 || i === allScripts.length - 1) {
        process.stdout.write(`\r[${i + 1}/${allScripts.length}] scripts embedded...`);
      }
      const combinedText = `${script.creative_code} ${script.product} ${script.hook} ${script.script_text}`.slice(0, 1500);
      const out = await embedder(combinedText, { pooling: 'mean', normalize: true });
      scriptEmbeddings.push({
        ad_id: script.ad_id,
        creative_code: script.creative_code,
        product: script.product,
        creator: script.creator,
        editor: script.editor,
        hook: script.hook,
        embedding: Array.from(out.data)
      });
    }
    fs.writeFileSync(embeddingsCachePath, JSON.stringify(scriptEmbeddings), 'utf8');
    console.log(`\nCompleted script embedding in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
  } else {
    console.log(`Using ${scriptEmbeddings.length} cached script embeddings.`);
  }

  const targetTranscripts = availableTranscripts.slice(0, limit);
  console.log(`\nEvaluating AI matching for ${targetTranscripts.length} Meta ad transcripts...`);

  const results = [];
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let unmatchedCount = 0;

  for (let i = 0; i < targetTranscripts.length; i++) {
    const item = targetTranscripts[i];
    const rawTranscript = item.transcript;
    const transliterated = transliterateDevanagari(rawTranscript);
    const combinedTranscript = `${item.meta_ad_name} ${transliterated}`.slice(0, 1500);

    const tOut = await embedder(combinedTranscript, { pooling: 'mean', normalize: true });
    const tVector = Array.from(tOut.data);

    // Score all scripts
    const scored = [];
    const tKeywords = extractKeywords(transliterated);

    for (let j = 0; j < scriptEmbeddings.length; j++) {
      const sc = scriptEmbeddings[j];
      let sim = cosineSimilarity(tVector, sc.embedding);

      // Check key keyword bonus (shared entities like 999, buy 2 get 1, satmi, papa, etc.)
      let sharedCount = 0;
      const sKeywords = extractKeywords(allScripts[j].script_text);
      for (const kw of tKeywords) {
        if (sKeywords.has(kw)) sharedCount++;
      }

      if (sharedCount >= 3) {
        sim += Math.min(sharedCount * 0.015, 0.06);
      }

      scored.push({
        candidate: sc,
        script: allScripts[j],
        sim: Number(sim.toFixed(4)),
        sharedKeywords: sharedCount
      });
    }

    scored.sort((a, b) => b.sim - a.sim);

    const best = scored[0];
    const second = scored[1];
    const margin = Number((best.sim - (second?.sim || 0)).toFixed(4));

    let confidence = 'unmatched';
    let matchedAdId = null;
    let matchedCode = null;
    let rationale = '';

    if (best.sim >= 0.74 && margin >= 0.06) {
      confidence = 'high';
      matchedAdId = best.candidate.ad_id;
      matchedCode = best.candidate.creative_code;
      highCount++;
      rationale = `High confidence match (${(best.sim * 100).toFixed(1)}%, margin: +${(margin * 100).toFixed(1)}%). Transcribed spoken speech aligns with ${best.candidate.creative_code} ("${best.candidate.product}"). Hook/theme: "${best.candidate.hook.slice(0, 80)}...". Creator: ${best.candidate.creator}.`;
    } else if (best.sim >= 0.65 && margin >= 0.04) {
      confidence = 'medium';
      matchedAdId = best.candidate.ad_id;
      matchedCode = best.candidate.creative_code;
      mediumCount++;
      rationale = `Moderate match (${(best.sim * 100).toFixed(1)}%, margin: +${(margin * 100).toFixed(1)}%). Corresponds to ${best.candidate.creative_code} ("${best.candidate.product}"). Hook: "${best.candidate.hook.slice(0, 80)}...". Needs reviewer verification.`;
    } else if (best.sim >= 0.58) {
      confidence = 'low';
      lowCount++;
      rationale = `Low confidence match (${(best.sim * 100).toFixed(1)}%). Closest candidate is ${best.candidate.creative_code} ("${best.candidate.product}"), but margin is narrow (+${(margin * 100).toFixed(1)}%).`;
    } else {
      confidence = 'unmatched';
      unmatchedCount++;
      rationale = `No confident match found. Best score was ${(best.sim * 100).toFixed(1)}% for ${best.candidate.creative_code}, which falls below threshold.`;
    }

    results.push({
      meta_ad_id: item.meta_ad_id,
      meta_ad_name: item.meta_ad_name,
      spend: item.spend,
      language: item.language,
      matched_ad_id: matchedAdId,
      matched_creative_code: matchedCode,
      matched_product: matchedCode ? best.candidate.product : null,
      matched_creator: matchedCode ? best.candidate.creator : null,
      matched_editor: matchedCode ? best.candidate.editor : null,
      match_confidence: confidence,
      similarity_score: best.sim,
      margin: margin,
      rationale: rationale,
      transcript_snippet: rawTranscript.slice(0, 160) + (rawTranscript.length > 160 ? '...' : ''),
      runner_up_creative_code: second ? second.candidate.creative_code : null,
      runner_up_score: second ? second.sim : null
    });
  }

  // 1. Save JSON
  const matchesJsonPath = path.join(dataDir, 'ai-script-matches.json');
  fs.writeFileSync(matchesJsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nSaved matches JSON: ${matchesJsonPath}`);

  // 2. Save Markdown
  const matchesMdPath = path.join(dataDir, 'ai-script-matches.md');
  const mdHeader = [
    '# AI One-Shot Video Mapping Results',
    `Generated on: ${new Date().toISOString()}`,
    `Total Transcripts Evaluated: ${results.length}`,
    `High Confidence Matches: ${highCount}`,
    `Medium Confidence Matches: ${mediumCount}`,
    `Low Confidence / Unmatched: ${lowCount + unmatchedCount}`,
    '',
    '---',
    ''
  ].join('\n');

  let mdContent = mdHeader;
  for (const res of results) {
    mdContent += `### Meta Ad: ${res.meta_ad_name || 'Unnamed'} (ID: ${res.meta_ad_id})\n`;
    mdContent += `- **Spend**: ₹${res.spend.toLocaleString('en-IN')}\n`;
    mdContent += `- **Confidence**: \`${res.match_confidence.toUpperCase()}\` | **Similarity Score**: ${(res.similarity_score * 100).toFixed(1)}% (Margin: +${(res.margin * 100).toFixed(1)}%)\n`;
    if (res.matched_creative_code) {
      mdContent += `- **Matched Creative**: **${res.matched_creative_code}** (${res.matched_ad_id})\n`;
      mdContent += `- **Product**: ${res.matched_product} | **Creator**: ${res.matched_creator} | **Editor**: ${res.matched_editor}\n`;
    }
    mdContent += `- **AI Rationale**: ${res.rationale}\n`;
    mdContent += `- **Spoken Transcript Snippet**:\n  > "${res.transcript_snippet}"\n\n---\n\n`;
  }

  fs.writeFileSync(matchesMdPath, mdContent, 'utf8');
  console.log(`Saved matches Markdown: ${matchesMdPath}`);

  console.log('\n=== Summary of AI Matches ===');
  console.log(`- High Confidence (Auto-Approvable): ${highCount}`);
  console.log(`- Medium Confidence (Review Suggested): ${mediumCount}`);
  console.log(`- Low Confidence: ${lowCount}`);
  console.log(`- Unmatched: ${unmatchedCount}`);

  // Apply to Supabase if requested
  if (applyDb) {
    if (!supabase) {
      console.error('\nCannot apply to database: Supabase credentials not found.');
      return;
    }

    console.log('\nApplying AI matches to Supabase (meta_ad_transcript_mappings and incentive_creatives)...');
    let dbUpdated = 0;
    let incentiveLinked = 0;

    for (const r of results) {
      if (r.matched_ad_id) {
        // Update meta_ad_transcript_mappings
        const { error: mapErr } = await supabase
          .from('meta_ad_transcript_mappings')
          .update({
            matched_ad_id: r.matched_ad_id,
            match_score: r.similarity_score,
            match_confidence: r.match_confidence,
            transcript_source: 'ai_semantic_match',
            review_note: r.rationale,
            reviewed_at: new Date().toISOString()
          })
          .eq('meta_ad_id', r.meta_ad_id);

        if (!mapErr) dbUpdated++;

        // For high-confidence matches, link attribution to meta_ads and incentive_creatives
        if (r.match_confidence === 'high') {
          await supabase
            .from('meta_ads')
            .update({ matched_ad_id: r.matched_ad_id })
            .eq('id', r.meta_ad_id);

          const { error: incErr } = await supabase
            .from('incentive_creatives')
            .update({ creative_id: r.matched_ad_id })
            .eq('meta_ad_id', r.meta_ad_id);
          if (!incErr) incentiveLinked++;
        }
      }
    }

    console.log(`Updated ${dbUpdated} rows in meta_ad_transcript_mappings.`);
    console.log(`Linked ${incentiveLinked} high-confidence creative attributions in incentive_creatives.`);
  } else {
    console.log('\nTip: Run with `--apply` to commit these AI matches to Supabase and update Ads Performance attribution.');
  }
}

main().catch((err) => {
  console.error('AI Matching failed:', err);
  process.exit(1);
});
