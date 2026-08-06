const { createClient } = require('@supabase/supabase-js');

const clipName = process.argv[2];
if (!clipName) {
  console.error('Usage: node get-all-segments.cjs "HK 33"');
  process.exit(1);
}

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: clip } = await supabase.from('ads').select('id, name').eq('name', clipName).single();
  if (!clip) { console.log('Clip not found'); return; }

  const { data: segments } = await supabase.from('raw_clip_segments')
    .select('segment_index, start_seconds, end_seconds, visual_description, environment_description, on_screen_text, people_description, spoken_text')
    .eq('ad_id', clip.id)
    .order('segment_index');

  console.log('All segments for ' + clip.name + ' (' + (segments ? segments.length : 0) + ' total):\n');
  (segments || []).forEach((s) => {
    console.log('[' + s.start_seconds + '-' + s.end_seconds + 's]');
    console.log('  visual:      ' + s.visual_description);
    console.log('  environment: ' + (s.environment_description || ''));
    console.log('  on-screen:   ' + (s.on_screen_text || ''));
    console.log('  people:      ' + (s.people_description || ''));
    console.log('  spoken:      "' + (s.spoken_text || '') + '"');
    console.log('');
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
