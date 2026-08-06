const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 100;
const PROGRESS_EVERY = 100;
const DEFAULT_LIMIT = null;

async function main() {
  for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
    if (!value) {
      console.error(`Missing required env var: ${name}`);
      process.exit(1);
    }
  }

  const args = parseArgs(process.argv.slice(2));
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { embedWithGemini, buildSegmentEmbedInput, DailyQuotaError } = await import('../lib/raw-clips.js');

  const { count: totalCount, error: countError } = await supabase
    .from('raw_clip_segments')
    .select('id', { count: 'exact', head: true })
    .is('embedding_gemini', null);

  if (countError) {
    throw new Error(`Failed to count segments needing backfill: ${countError.message}`);
  }

  const totalToProcess = Number(totalCount || 0);
  console.log(`Found ${totalToProcess} raw clip segment(s) needing Gemini embeddings.`);

  if (totalToProcess === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : DEFAULT_LIMIT;
  let processed = 0;
  let updated = 0;
  let lastProcessedSegmentId = null;

  while (true) {
    let query = supabase
      .from('raw_clip_segments')
      .select('id, ad_id, segment_index, visual_description, spoken_text, environment_description, on_screen_text, people_description, embedding_gemini')
      .is('embedding_gemini', null)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (lastProcessedSegmentId) {
      query = query.gt('id', lastProcessedSegmentId);
    }

    if (limit && processed >= limit) {
      break;
    }

    const { data: rows, error } = await query;
    if (error) {
      throw new Error(`Failed to load raw clip segments: ${error.message}`);
    }

    if (!rows || rows.length === 0) {
      break;
    }

    for (const row of rows) {
      if (limit && processed >= limit) {
        break;
      }

      lastProcessedSegmentId = row.id;
      processed += 1;

      const embedInput = buildSegmentEmbedInput(
        row.visual_description,
        row.spoken_text || '',
        row.environment_description || '',
        row.on_screen_text || '',
        row.people_description || ''
      );

      try {
        const embedding = await embedWithGemini(embedInput);
        const { error: updateError } = await supabase
          .from('raw_clip_segments')
          .update({ embedding_gemini: embedding })
          .eq('id', row.id)
          .is('embedding_gemini', null);

        if (updateError) {
          throw new Error(`Failed to update segment ${row.id}: ${updateError.message}`);
        }

        updated += 1;
      } catch (err) {
        if (err instanceof DailyQuotaError) {
          console.error(`[QUOTA] Daily limit reached after ${updated} updated segment(s). Safe to resume later.`);
          process.exit(75);
        }

        console.error(`Failed to embed segment ${row.id}: ${err.message}`);
      }

      if (processed % PROGRESS_EVERY === 0 || processed === totalToProcess) {
        console.log(`Progress: processed ${processed}/${totalToProcess}, updated ${updated}`);
      }
    }

    if (limit && processed >= limit) {
      break;
    }
  }

  console.log(`Backfill finished. Updated ${updated}/${totalToProcess} segment(s).`);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--limit') {
      result.limit = Number(argv[++i]);
    }
  }
  return result;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});