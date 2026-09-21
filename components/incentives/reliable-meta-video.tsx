"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type LiveMetaVideo = { adId: string; creativeId: string; videoId: string; mediaType: "video"; mediaUrl: string; downloadUrl: string };

export function ReliableMetaVideo({ adId, creativeId, videoId, className = "max-h-[32rem] w-full object-contain", onResolved }: { adId: string; creativeId?: string | null; videoId?: string | null; className?: string; onResolved?: (asset: LiveMetaVideo) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [asset, setAsset] = useState<LiveMetaVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({ adId });
    if (creativeId) params.set("creativeId", creativeId);
    if (videoId) params.set("videoId", videoId);
    params.set("fresh", String(attempt));
    return `/api/incentives/meta-preview?${params.toString()}`;
  }, [adId, attempt, creativeId, videoId]);

  useEffect(() => {
    const controller = new AbortController();
    setAsset(null); setError(null); setLoading(true);
    fetch(requestUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "The exact Meta video could not be resolved."); return payload as LiveMetaVideo; })
      .then((resolved) => { setAsset(resolved); onResolved?.(resolved); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The exact Meta video could not be resolved."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [requestUrl, onResolved]);

  if (loading) return <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Fetching the exact video from Meta…</div>;
  if (error || !asset) return <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center"><p className="text-sm text-destructive">{error ?? "The exact Meta video is unavailable."}</p><Button size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}><RefreshCw className="size-4" />Retry live Meta lookup</Button></div>;
  return <video key={`${asset.adId}:${asset.creativeId}:${asset.videoId}:${attempt}`} src={asset.mediaUrl} controls autoPlay muted preload="metadata" playsInline className={className} onError={() => { setAsset(null); setError("Meta resolved the correct video identity, but its live stream could not be played. Retry to request a new source URL."); }} />;
}
