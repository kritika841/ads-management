"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ReliableMetaVideo, type LiveMetaVideo } from "@/components/incentives/reliable-meta-video";
import type { IncentiveCreative, MetaAd } from "@/lib/incentives";

export function CreativeDetailsModal({ creative, meta, onClose }: { creative: IncentiveCreative; meta?: MetaAd; onClose: () => void }) {
  const [resolved, setResolved] = useState<LiveMetaVideo | null>(null);
  const libraryMediaUrl = creative.ad.drive_file_id ? `/api/ads/${creative.ad.id}/media?fileId=${encodeURIComponent(creative.ad.drive_file_id)}` : creative.ad.resolved_video_url;
  return <Modal open labelledBy="creative-preview-title" onClose={onClose}>
    <section className="mx-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-card shadow-float">
      <div className="flex items-start justify-between border-b border-border p-5">
        <div><h2 id="creative-preview-title" className="text-lg font-semibold text-foreground">{creative.ad.name}</h2><p className="mt-1 text-xs text-muted-foreground">{meta?.campaign_name ?? "—"} · Meta ad {creative.meta_ad_id}</p></div>
        <Button size="icon" variant="ghost" onClick={onClose} title="Close"><X className="size-5" /></Button>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-lg border border-border bg-neutral-950">{libraryMediaUrl ? <video src={libraryMediaUrl} controls autoPlay muted preload="auto" playsInline className="max-h-[32rem] w-full object-contain" /> : <ReliableMetaVideo adId={creative.meta_ad_id} creativeId={meta?.creative_id} onResolved={setResolved} />}</div>
        <div className="grid gap-3 sm:grid-cols-2"><Info label="Video source" value={libraryMediaUrl ? "Creative Library" : "Live Meta fallback"} /><Info label="Meta ad ID" value={creative.meta_ad_id} /><Info label="Meta creative ID" value={resolved?.creativeId ?? meta?.creative_id ?? "—"} /><Info label="Meta video ID" value={libraryMediaUrl ? "Stored Creative Library video" : resolved?.videoId ?? "Resolving live from Meta"} /><Info label="Product" value={creative.campaign.product?.name ?? "—"} /><Info label="Creator" value={creative.creator?.name ?? creative.ad.creator?.name ?? "—"} /><Info label="Editor" value={creative.editor?.name ?? creative.ad.editor?.name ?? "—"} /><Info label="Result" value={(creative.decision_status ?? creative.evaluation_status).replaceAll("_", " ")} /></div>
        {libraryMediaUrl ? <a className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted" href={`/api/ads/${creative.ad.id}/download`} target="_blank" rel="noreferrer"><Download className="size-4" />Download Creative Library video</a> : resolved ? <a className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted" href={resolved.downloadUrl} target="_blank" rel="noreferrer"><Download className="size-4" />Download exact Meta video</a> : null}
      </div>
    </section>
  </Modal>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium text-foreground">{value}</p></div>;
}
