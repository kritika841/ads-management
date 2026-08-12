import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { embedWithGemini, groupSegmentMatchesByClip } from '@/lib/raw-clips';

type SearchResult = {
  raw_clip_id: string;
  ad_id: string;
  name: string | null;
  raw_footage_url: string;
  resolved_video_url: string | null;
  thumbnail_url: string | null;
  start_seconds: number;
  end_seconds: number;
  visual_description: string;
  spoken_text: string;
  similarity: number;
};

export async function POST(req: NextRequest) {
  try {
    const supabaseServer = await createSupabaseServerClient();
    const { data: { user } } = await supabaseServer.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await req.json().catch(() => ({}));
    const query = body?.query;
    if (typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }
    if (query.trim().length > 500) {
      return NextResponse.json({ error: 'Query too long' }, { status: 400 });
    }

    const queryText = query.trim();

    // Gemini-only search — no MiniLM fallback
    console.info('Using Gemini embeddings for raw clip search');
    const queryEmbedding = await embedWithGemini(queryText);
    const { data, error } = await supabaseAdmin.rpc('match_clip_segments_gemini', {
      query_embedding: queryEmbedding,
      similarity_threshold: 0.25,
      match_count: 40,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let rankedResults: SearchResult[] = groupSegmentMatchesByClip(data || [], 15).map((match: {
      raw_clip_id?: string | null;
      ad_id: string;
      start_seconds: number | string;
      end_seconds: number | string;
      visual_description: string;
      spoken_text?: string | null;
      similarity: number | string;
    }) => ({
      raw_clip_id: match.raw_clip_id || match.ad_id,
      ad_id: match.ad_id,
      name: null,
      raw_footage_url: '',
      resolved_video_url: null,
      thumbnail_url: null,
      start_seconds: Number(match.start_seconds),
      end_seconds: Number(match.end_seconds),
      visual_description: match.visual_description,
      spoken_text: match.spoken_text || '',
      similarity: Number(match.similarity),
    }));

    if (rankedResults.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const rawClipIds = rankedResults.map((result) => result.raw_clip_id);
    const adIds = rankedResults.map((result) => result.ad_id);
    const { data: rawClips, error: rawClipsError } = await supabaseServer
      .from('raw_clips')
      .select('id, ad_id, resolved_video_url, source_raw_footage_url, thumbnail_url, ingest_status, ads:ad_id (name)')
      .or(`id.in.(${rawClipIds.join(',')}),ad_id.in.(${adIds.join(',')})`);

    if (rawClipsError) {
      return NextResponse.json({ error: rawClipsError.message }, { status: 500 });
    }

    const rawClipsById = new Map<string, {
      ad_id: string;
      name: string | null;
      raw_footage_url: string;
      resolved_video_url: string | null;
      thumbnail_url: string | null;
    }>();
    const preferredRawClipByAdId = new Map<string, {
      id: string;
      ad_id: string;
      name: string | null;
      raw_footage_url: string;
      resolved_video_url: string | null;
      thumbnail_url: string | null;
      ingest_status: string | null;
    }>();
    for (const rawClip of rawClips || []) {
      const relatedAd = (rawClip as { ads?: { name?: string | null } | Array<{ name?: string | null }> }).ads;
      const adName = Array.isArray(relatedAd) ? relatedAd[0]?.name ?? null : relatedAd?.name ?? null;
      const normalized = {
        ad_id: rawClip.ad_id,
        name: adName,
        raw_footage_url: rawClip.source_raw_footage_url,
        resolved_video_url: rawClip.resolved_video_url,
        thumbnail_url: rawClip.thumbnail_url,
      };
      rawClipsById.set(rawClip.id, normalized);

      const currentPreferred = preferredRawClipByAdId.get(rawClip.ad_id);
      if (!currentPreferred || (currentPreferred.ingest_status !== 'done' && rawClip.ingest_status === 'done')) {
        preferredRawClipByAdId.set(rawClip.ad_id, {
          id: rawClip.id,
          ingest_status: rawClip.ingest_status,
          ...normalized,
        });
      }
    }

    rankedResults = rankedResults
      .map((result) => {
        const rawClip = rawClipsById.get(result.raw_clip_id) || preferredRawClipByAdId.get(result.ad_id);
        if (!rawClip) return null;
        return {
          ...result,
          ad_id: rawClip.ad_id,
          name: rawClip.name,
          raw_footage_url: rawClip.raw_footage_url,
          resolved_video_url: rawClip.resolved_video_url,
          thumbnail_url: rawClip.thumbnail_url,
        };
      })
      .filter((result): result is SearchResult => result !== null);

    return NextResponse.json({ results: rankedResults });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
