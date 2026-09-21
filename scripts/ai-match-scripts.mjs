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

function normalizeSpelling(text) {
  return text
    .toLowerCase()
    .replace(/khushboo|khushbu|khusboo|khusbu/g, 'khushbu')
    .replace(/agarbatti|agarbathi|agarbati|incense/g, 'agarbatti')
    .replace(/dhuaand|dhuand|dhuaan|dhuan/g, 'dhuan')
    .replace(/dabbe|dibbe|dabba|dibba|boxes|box/g, 'dabbe')
    .replace(/nau sau ninyanve|nine point nine nine|nine ninety nine|999|₹999/g, 'num999')
    .replace(/buy two get one free|buy 2 get 1 free|buy too get one free|b2g1/g, 'b2g1')
    .replace(/teen|three|tin/g, 'num3')
    .replace(/ceramic stand|ceramic stand free/g, 'ceramicstand')
    .replace(/bambooless|bamboo less/g, 'bambooless')
    .replace(/charcoal free|charcoal-free|charcoalfree/g, 'charcoalfree')
    .replace(/satmi|satmya|satmiya/g, 'satmi')
    .replace(/white wash|whitewash|paint ki smell/g, 'whitewash')
    .replace(/papa ne dekha|papa bole/g, 'papadialogue')
    .replace(/mehmaan|mehman/g, 'mehman')
    .replace(/janmashtami|krishna ji|krishna bhagwan/g, 'janmashtami')
    .replace(/\s+/g, ' ')
    .trim();
}

function identifyAnchors(text) {
  const norm = normalizeSpelling(transliterateDevanagari(text));
  const found = new Set();
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
    console.log(`Computing multi-anchor embeddings for ${allScripts.length} scripts in Creative Library...`);
    const startTime = Date.now();
    for (let i = 0; i < allScripts.length; i++) {
      const script = allScripts[i];
      if ((i + 1) % 50 === 0 || i === allScripts.length - 1) {
        process.stdout.write(`\r[${i + 1}/${allScripts.length}] scripts embedded...`);
      }
      const combinedText = `${script.creative_code} ${script.product} ${script.hook} ${script.script_text}`.slice(0, 1500);
      const out = await embedder(combinedText, { pooling: 'mean', normalize: true });

      const sHook = transliterateDevanagari(script.hook || script.product).slice(0, 160);
      const hookOut = await embedder(sHook, { pooling: 'mean', normalize: true });

      scriptEmbeddings.push({
        ad_id: script.ad_id,
        creative_code: script.creative_code,
        product: script.product,
        creator: script.creator,
        editor: script.editor,
        hook: script.hook,
        embedding: Array.from(out.data),
        hookEmbedding: Array.from(hookOut.data),
        anchors: Array.from(identifyAnchors(script.script_text || ''))
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

    // Multi-Anchor Triangulation
    const tAnchors = identifyAnchors(transliterated);
    const tHook = transliterated.slice(0, 160);
    const tHookOut = await embedder(tHook, { pooling: 'mean', normalize: true });
    const tHookVector = Array.from(tHookOut.data);

    // Score all scripts in memory via instant dot products
    const scored = [];

    for (let j = 0; j < scriptEmbeddings.length; j++) {
      const sc = scriptEmbeddings[j];
      const sim = cosineSimilarity(tVector, sc.embedding);
      const hookSim = sc.hookEmbedding ? cosineSimilarity(tHookVector, sc.hookEmbedding) : sim;

      // Check shared commercial & narrative anchors
      const sAnchors = new Set(sc.anchors || []);
      const sharedAnchors = [];
      for (const a of tAnchors) {
        if (sAnchors.has(a)) sharedAnchors.push(a);
      }

      // Composite multi-anchor weighted similarity
      let compositeScore = sim * 0.70 + hookSim * 0.20;
      if (sharedAnchors.length >= 2) {
        compositeScore += Math.min(sharedAnchors.length * 0.03, 0.10);
      } else if (sharedAnchors.length === 1) {
        compositeScore += 0.02;
      }

      compositeScore = Math.min(Math.max(compositeScore, 0), 1);

      scored.push({
        candidate: sc,
        script: allScripts[j],
        sim: Number(compositeScore.toFixed(4)),
        bodySim: Number(sim.toFixed(4)),
        hookSim: Number(hookSim.toFixed(4)),
        sharedAnchors
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

    const hasStrongAnchors = best.sharedAnchors.length >= 2 || (best.sharedAnchors.length >= 1 && best.hookSim >= 0.70);

    if (best.sim >= 0.76 && margin >= 0.05 && hasStrongAnchors) {
      confidence = 'high';
      matchedAdId = best.candidate.ad_id;
      matchedCode = best.candidate.creative_code;
      highCount++;
      rationale = `High confidence (${(best.sim * 100).toFixed(1)}%, margin: +${(margin * 100).toFixed(1)}%). Corresponds to ${best.candidate.creative_code} ("${best.candidate.product}"). Hook: "${best.candidate.hook.slice(0, 70)}...". Anchors verified: [${best.sharedAnchors.join(', ')}]. Creator: ${best.candidate.creator}, Editor: ${best.candidate.editor}.`;
    } else if (best.sim >= 0.65 && margin >= 0.03) {
      confidence = 'medium';
      matchedAdId = best.candidate.ad_id;
      matchedCode = best.candidate.creative_code;
      mediumCount++;
      rationale = `Moderate match (${(best.sim * 100).toFixed(1)}%, margin: +${(margin * 100).toFixed(1)}%). Corresponds to ${best.candidate.creative_code} ("${best.candidate.product}"). Anchors: [${best.sharedAnchors.join(', ')}]. Review suggested.`;
    } else if (best.sim >= 0.55) {
      confidence = 'low';
      lowCount++;
      rationale = `Low confidence (${(best.sim * 100).toFixed(1)}%). Nearest candidate is ${best.candidate.creative_code}, but margin (+${(margin * 100).toFixed(1)}%) or anchor evidence is narrow.`;
    } else {
      confidence = 'unmatched';
      unmatchedCount++;
      rationale = `No confident match found. Best candidate was ${best.candidate.creative_code} (${(best.sim * 100).toFixed(1)}%), below threshold.`;
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
      anchors_matched: best.sharedAnchors,
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
