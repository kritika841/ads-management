"use client";

import Link from "next/link";
import { ArrowUpRight, Video, X } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { resolveAdThumbnailUrl } from "@/lib/drive-urls";
import { cn } from "@/lib/utils";
import type { AdWithRelations } from "@/lib/types";

export function AdPreviewModal({
  ad,
  onClose
}: {
  ad: AdWithRelations | null;
  onClose: () => void;
}) {
  if (!ad) {
    return null;
  }

  const thumbnailSrc = resolveAdThumbnailUrl(ad.thumbnail_url, ad.drive_file_id);

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/50 p-0 backdrop-blur-[2px] sm:p-6" role="dialog" aria-modal="true" aria-labelledby="preview-title">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden bg-card shadow-float sm:rounded-xl">
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="preview-title" className="truncate text-lg font-semibold text-foreground">{ad.name}</h2>
              <StatusBadge status={ad.status} />
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {ad.creator ? <Avatar name={ad.creator.name} src={ad.creator.avatar_url} className="size-6" /> : null}
              <span>{ad.creator?.name ?? "Unknown creator"}</span>
              <span className="text-border">/</span>
              <span>Edited by {ad.editor?.name ?? "Unassigned"}</span>
              <span className="hidden text-border sm:inline">/</span>
              <span className="hidden truncate sm:inline">{ad.campaign?.name ?? "No campaign"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/ads/${ad.id}`}
              aria-label="Open full review"
              className={cn(
                "inline-flex size-9 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 sm:w-auto sm:px-3"
              )}
            >
              <span className="hidden sm:inline">Open review</span>
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
            <Button variant="ghost" size="icon" onClick={onClose} title="Close preview">
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)] lg:overflow-hidden">
          <div className="min-h-[300px] bg-neutral-950 lg:min-h-0">
            {ad.preview_url ? (
              <iframe src={ad.preview_url} title={ad.name} className="h-full min-h-[280px] w-full" allow="autoplay" />
            ) : thumbnailSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbnailSrc} alt="" className="h-full min-h-[280px] w-full object-contain" />
            ) : (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground"><Video className="size-7" aria-hidden />Preview unavailable</div>
            )}
          </div>
          <aside className="min-h-0 border-t border-border p-5 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:p-6">
            <div className="flex items-center justify-between gap-3"><h3 className="section-heading">Script</h3><span className="text-xs text-muted-foreground">{ad.script_text?.split(/\s+/).filter(Boolean).length ?? 0} words</span></div>
            <div
              className="prose-script mt-4 text-sm"
              dangerouslySetInnerHTML={{ __html: ad.script_html || "<p>No script added.</p>" }}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
