/**
 * search-preview.cjs
 *
 * Usage:
 *   node -r dotenv/config scripts/search-preview.cjs "your query here" dotenv_config_path=.env.local
 *
 * Shows the top 10 ranked clips for a query, with similarity scores and
 * the matching segment text - no expected answer needed, just exploration.
 */
const { createClient } = require('@supabase/supabase-js');

const query = process.argv[2];
if (!query) {
  console.error('Usage: node search-preview.cjs "query text"');
  process.exit(1);
}

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { pipeline } = await import('@xenova/transformers');
  const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const output = await embed(query, { pooling: 'mean', normalize: true });
  const queryEmbedding = Array.from(output.data);

  const { data, error } = await supabase.rpc('match_clip_segments', {
    query_embedding: queryEmbedding,
    match_count: 100,
    similarity_threshold: 0,
  });

  if (error) { console.error('RPC error:', error.message); process.exit(1); }

  const bestByAd = {};
  for (const row of data) {
    if (!bestByAd[row.ad_id] || row.similarity > bestByAd[row.ad_id].similarity) {
      bestByAd[row.ad_id] = row;
    }
  }
  const ranked = Object.values(bestByAd).sort((a, b) => b.similarity - a.similarity);

  const { data: ads } = await supabase.from('ads').select('id, name').in('id', ranked.slice(0, 10).map(r => r.ad_id));
  const nameById = Object.fromEntries((ads || []).map(a => [a.id, a.name]));

  console.log(`\nQuery: "${query}"`);
  console.log(`Total distinct clips scored: ${ranked.length}\n`);
  console.log('Top 10:');
  ranked.slice(0, 10).forEach((r, i) => {
    console.log(`  #${i + 1}  ${r.similarity.toFixed(4)}  ${nameById[r.ad_id] || r.ad_id}`);
    console.log(`         "${r.visual_description}"`);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
