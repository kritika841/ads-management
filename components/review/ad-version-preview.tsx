"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, Loader2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useVideoTimestamp } from "@/components/review/video-timestamp-context";
import { resolveAdThumbnailUrl } from "@/lib/drive-urls";
import type { AdVersion, AdWithRelations } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

type PreviewItem = {
  key: string;
  label: string;
  date: string;
  driveUrl: string | null;
  driveFileId: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  scriptHtml: string | null;
};

export function AdVersionPreview({
  ad,
  versions
}: {
  ad: AdWithRelations;
  versions: AdVersion[];
}) {
  const items = useMemo<PreviewItem[]>(() => {
    const sortedVersions = [...versions].sort((a, b) => b.version_number - a.version_number);

    return [
      {
        key: "current",
        label: "Current",
        date: ad.updated_at,
        driveUrl: ad.drive_url,
        driveFileId: ad.drive_file_id,
        previewUrl: ad.preview_url,
        thumbnailUrl: ad.thumbnail_url,
        scriptHtml: ad.script_html
      },
      ...sortedVersions.map((version) => ({
        key: version.id,
        label: `v${version.version_number}`,
        date: version.created_at,
        driveUrl: version.drive_url,
        driveFileId: version.drive_file_id,
        previewUrl: version.preview_url,
        thumbnailUrl: null,
        scriptHtml: version.script_html
      }))
    ];
  }, [ad, versions]);

  const [selectedKey, setSelectedKey] = useState(items[0]?.key ?? "current");
  const [failedMedia, setFailedMedia] = useState<Set<string>>(() => new Set());
  const [downloading, setDownloading] = useState(false);
  const { registerVideo } = useVideoTimestamp();
  const { toast } = useToast();
  const selected = items.find((item) => item.key === selectedKey) ?? items[0];
  const thumbnailSrc = selected?.key === "current" && ad.drive_file_id
    ? `/api/ads/${ad.id}/thumbnail?v=${encodeURIComponent(ad.drive_file_id)}`
    : resolveAdThumbnailUrl(selected?.thumbnailUrl, selected?.driveFileId);

  async function downloadSelected() {
    if (!selected?.driveFileId || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/ads/${ad.id}/download?fileId=${encodeURIComponent(selected.driveFileId)}`);
      if (!res.ok) { toast({ title: "Download failed", description: `Could not download ${ad.name}. Try again.`, tone: "error" }); return; }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${ad.name}.mp4`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: `${ad.name} downloaded`, tone: "success" });
    } catch {
      toast({ title: "Download failed", description: "Network error — please try again.", tone: "error" });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-3">
        <div className="flex flex-wrap rounded-md bg-muted p-1">
          {items.map((item) => (
            <Button
              key={item.key}
              size="sm"
              variant={item.key === selected.key ? "secondary" : "ghost"}
              className="h-8 border-transparent px-3 shadow-none"
              onClick={() => setSelectedKey(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {selected?.driveFileId ? (
            <button
              type="button"
              disabled={downloading}
              onClick={downloadSelected}
              className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Download
              {downloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            </button>
          ) : null}
          {selected?.driveUrl ? (
            <a
              href={selected.driveUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Drive
              <ExternalLink className="size-4" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="min-h-[360px] bg-neutral-950">
          {selected?.driveFileId && !failedMedia.has(selected.key) ? (
            <video
              key={`${selected.key}-${selected.driveFileId}`}
              ref={registerVideo}
              src={`/api/ads/${ad.id}/media?fileId=${encodeURIComponent(selected.driveFileId)}`}
              title={`${ad.name} ${selected.label}`}
              className="h-full min-h-[360px] w-full object-contain"
              controls
              playsInline
              preload="metadata"
              onError={() => {
                registerVideo(null);
                setFailedMedia((current) => new Set(current).add(selected.key));
              }}
            />
          ) : selected?.previewUrl ? (
            <iframe
              key={`${selected.key}-${selected.previewUrl}`}
              src={selected.previewUrl}
              title={`${ad.name} ${selected.label}`}
              className="h-full min-h-[360px] w-full"
              allow="autoplay"
            />
          ) : thumbnailSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnailSrc} alt="" className="h-full min-h-[360px] w-full object-contain" />
          ) : (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground"><Video className="size-7" aria-hidden />Preview unavailable</div>
          )}
        </div>
        <aside className="border-t border-border p-5 lg:max-h-[640px] lg:overflow-y-auto lg:border-l lg:border-t-0 lg:p-6">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-medium text-muted-foreground">Script</p><h2 className="section-heading mt-0.5">{selected?.label}</h2></div>
            {selected?.date ? (
              <span className="text-xs text-muted-foreground">{formatDateTime(selected.date)}</span>
            ) : null}
          </div>
          <div
            className="prose-script mt-5 text-sm"
            dangerouslySetInnerHTML={{ __html: selected?.scriptHtml || "<p>No script added.</p>" }}
          />
        </aside>
      </div>
    </section>
  );
}
