import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type RawClipStatus = 'pending' | 'processing' | 'done' | 'error';

type RawClipItem = {
  id: string;
  ad_id: string;
  name: string | null;
  raw_footage_url: string;
  resolved_video_url: string | null;
  thumbnail_url: string | null;
  raw_clip_description: string | null;
  segment_ingest_status: RawClipStatus | null;
  segment_ingest_error: string | null;
  created_at: string;
  preview_visual_description: string | null;
};

export async function GET(req: NextRequest) {
  const supabaseServer = await createSupabaseServerClient();
  const { data: { user } } = await supabaseServer.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const page = Number(searchParams.get('page') || '1');
  const pageSize = Number(searchParams.get('pageSize') || '24');
  const statusParam = (searchParams.get('status') || 'all').toLowerCase();

  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return NextResponse.json({ error: 'Invalid pageSize' }, { status: 400 });
  }

  const statusFilter = statusParam === 'all' ? null : statusParam;
  const statusValues = statusFilter === 'pending' ? ['pending', 'processing'] : [statusFilter];

  let query = supabaseServer
    .from('raw_clips')
    .select('id, ad_id, title, source_raw_footage_url, resolved_video_url, thumbnail_url, preview_description, ingest_status, ingest_error, created_at', { count: 'exact' })
    .order('created_at', { ascending: false });

  const totalClipsPromise = supabaseServer
    .from('raw_clips')
    .select('id', { count: 'exact', head: true })
    .neq('drive_file_id', '');

  const taggedCountPromise = supabaseServer
    .from('raw_clips')
    .select('id', { count: 'exact', head: true })
    .eq('ingest_status', 'done');

  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');

  if (statusFilter) {
    if (statusFilter === 'pending') {
      query = query.in('ingest_status', statusValues as RawClipStatus[]);
    } else {
      query = query.eq('ingest_status', statusFilter as RawClipStatus);
    }
  }

  if (dateFrom) {
    query = query.gte('created_at', `${dateFrom}T00:00:00.000Z`);
  }
  if (dateTo) {
    query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data: rows, count, error } = await query.range(from, to);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const [{ count: totalClipsCount }, { count: taggedCount }] = await Promise.all([totalClipsPromise, taggedCountPromise]);

  const items = ((rows || []).map((row) => {
    return ({
    id: row.id,
    ad_id: row.ad_id,
    name: row.title || null,
    raw_footage_url: row.source_raw_footage_url,
    resolved_video_url: row.resolved_video_url,
    thumbnail_url: row.thumbnail_url,
    raw_clip_description: row.preview_description,
    segment_ingest_status: row.ingest_status,
    segment_ingest_error: row.ingest_error,
    created_at: row.created_at,
    preview_visual_description: row.preview_description,
  });
  })) as RawClipItem[];
  const doneClipIds = items
    .filter((item) => item.segment_ingest_status === 'done')
    .map((item) => item.id);

  const previewByClip = new Map<string, string>();
  if (doneClipIds.length > 0) {
    const { data: previews, error: previewError } = await supabaseServer
      .from('raw_clip_segments')
      .select('raw_clip_id, segment_index, visual_description')
      .in('raw_clip_id', doneClipIds)
      .order('raw_clip_id', { ascending: true })
      .order('segment_index', { ascending: true });

    if (previewError) {
      return NextResponse.json({ error: previewError.message }, { status: 500 });
    }

    for (const preview of previews || []) {
      if (preview.raw_clip_id && !previewByClip.has(preview.raw_clip_id)) {
        previewByClip.set(preview.raw_clip_id, preview.visual_description);
      }
    }
  }

  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return NextResponse.json({
    page,
    pageSize,
    total,
    totalPages,
    totalClips: totalClipsCount || 0,
    taggedCount: taggedCount || 0,
    items: items.map((item) => ({
      ...item,
      preview_visual_description: item.raw_clip_description || previewByClip.get(item.id) || null,
    })),
  });
}
