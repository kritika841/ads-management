const { createClient } = require('@supabase/supabase-js');

const clipName = process.argv[2];
if (!clipName) {
  console.error('Usage: node get-transcript.cjs "HK 33"');
  process.exit(1);
}

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: clip } = await supabase.from('raw_clips').select('id, title').eq('title', clipName).single();
  if (!clip) { console.log('Clip not found'); return; }

  const { data: segments } = await supabase.from('raw_clip_segments')
    .select('start_seconds, end_seconds, spoken_text')
    .eq('raw_clip_id', clip.id)
    .order('segment_index');

  console.log('Transcript for ' + clip.title + ':\n');
  (segments || []).forEach((s) => {
    if (s.spoken_text && s.spoken_text.trim()) {
      console.log('[' + s.start_seconds + '-' + s.end_seconds + 's] ' + s.spoken_text);
    }
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
