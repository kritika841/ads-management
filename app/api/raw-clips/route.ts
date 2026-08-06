import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type RawClipStatus = 'pending' | 'processing' | 'done' | 'error';

type RawClipItem = {
  id: string;
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
    .from('ads')
    .select('id, name, raw_footage_url, resolved_video_url, thumbnail_url, raw_clip_description, segment_ingest_status, segment_ingest_error, created_at', { count: 'exact' })
    .not('raw_footage_url', 'is', null)
    .order('created_at', { ascending: false });

  const totalClipsPromise = supabaseServer
    .from('ads')
    .select('id', { count: 'exact', head: true })
    .not('raw_footage_url', 'is', null);

  const taggedCountPromise = supabaseServer
    .from('ads')
    .select('id', { count: 'exact', head: true })
    .not('raw_footage_url', 'is', null)
    .eq('segment_ingest_status', 'done');

  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');

  if (statusFilter) {
    if (statusFilter === 'pending') {
      query = query.in('segment_ingest_status', statusValues as RawClipStatus[]);
    } else {
      query = query.eq('segment_ingest_status', statusFilter as RawClipStatus);
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

  const items = (rows || []) as RawClipItem[];
  const doneAdIds = items
    .filter((item) => item.segment_ingest_status === 'done')
    .map((item) => item.id);

  const previewByAd = new Map<string, string>();
  if (doneAdIds.length > 0) {
    const { data: previews, error: previewError } = await supabaseServer
      .from('raw_clip_segments')
      .select('ad_id, segment_index, visual_description')
      .in('ad_id', doneAdIds)
      .order('ad_id', { ascending: true })
      .order('segment_index', { ascending: true });

    if (previewError) {
      return NextResponse.json({ error: previewError.message }, { status: 500 });
    }

    for (const preview of previews || []) {
      if (!previewByAd.has(preview.ad_id)) {
        previewByAd.set(preview.ad_id, preview.visual_description);
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
      preview_visual_description: item.raw_clip_description || previewByAd.get(item.id) || null,
    })),
  });
}