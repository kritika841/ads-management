import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { embedWithGemini, groupSegmentMatchesByAd } from '@/lib/raw-clips';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type SearchResult = {
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
    const { data, error } = await supabase.rpc('match_clip_segments_gemini', {
      query_embedding: queryEmbedding,
      similarity_threshold: 0.25,
      match_count: 40,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let rankedResults: SearchResult[] = groupSegmentMatchesByAd(data || [], 15).map((match) => ({
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

    const adIds = rankedResults.map((result) => result.ad_id);
    const { data: ads, error: adsError } = await supabase
      .from('ads')
      .select('id, name, raw_footage_url, resolved_video_url, thumbnail_url')
      .in('id', adIds);

    if (adsError) {
      return NextResponse.json({ error: adsError.message }, { status: 500 });
    }

    const adsById = new Map<string, { name: string | null; raw_footage_url: string | null; resolved_video_url: string | null; thumbnail_url: string | null }>();
    for (const ad of ads || []) {
      adsById.set(ad.id, { name: ad.name, raw_footage_url: ad.raw_footage_url, resolved_video_url: ad.resolved_video_url, thumbnail_url: ad.thumbnail_url });
    }

    rankedResults = rankedResults
      .map((result) => {
        const ad = adsById.get(result.ad_id);
        if (!ad || !ad.raw_footage_url) return null;
        return {
          ...result,
          name: ad.name,
          raw_footage_url: ad.raw_footage_url,
          resolved_video_url: ad.resolved_video_url,
          thumbnail_url: ad.thumbnail_url,
        };
      })
      .filter((result): result is SearchResult => result !== null);

    return NextResponse.json({ results: rankedResults });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
