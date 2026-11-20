"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, Clapperboard, ExternalLink, Play, Video, X } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { FreezeEditingToggle } from "@/components/workflow/freeze-editing-toggle";
import { ProductionStageBadge } from "@/components/workflow/production-stage";
import { UnfreezeEditingButton } from "@/components/workflow/unfreeze-editing-button";
import { buildPlayableAdVideos, buildVariationPairs } from "@/lib/creative-variations";
import { resolveAdThumbnailUrl } from "@/lib/drive-urls";
import { canToggleEditingFreeze, isFinalMediaVisible, productionStageLabels } from "@/lib/production-workflow";
import { cn, formatDateOnly } from "@/lib/utils";
import type { AdWithRelations, EditingFreezeState, ProductionStage, UserRole } from "@/lib/types";

const pendingMediaCopy: Partial<Record<AdWithRelations["production_stage"], string>> = {
  script_writing: "The script is being written. The video appears here once the editor submits it.",
  ready_to_shoot: "The script is ready and waiting to be shot.",
  shoot_complete: "The shoot is complete. Assign an editor to start editing.",
  ready_for_edit: "An editor is assigned and editing hasn't started yet."
};

export function AdPreviewModal({
  ad,
  onClose,
  role,
  onFreezeChange
}: {
  ad: AdWithRelations | null;
  onClose: () => void;
  /** Viewer role — admins and managers get the editing freeze / unfreeze controls. */
  role?: UserRole;
  onFreezeChange?: (adId: string, state: EditingFreezeState, stage?: ProductionStage) => void;
}) {
  const [selectedVideoKey, setSelectedVideoKey] = useState("main");

  useEffect(() => {
    setSelectedVideoKey("main");
  }, [ad?.id]);

  if (!ad) {
    return null;
  }

  const mediaVisible = isFinalMediaVisible(ad.production_stage);
  const canManageEditing = role === "admin" || role === "manager";
  const showFreeze = canManageEditing && canToggleEditingFreeze(ad.production_stage);
  const showUnfreezeOverride = canManageEditing && Boolean(ad.editor_id) && ad.production_stage === "ready_for_edit";
  const playableVideos = mediaVisible ? buildPlayableAdVideos(ad) : [];
  const activeVideo = playableVideos.find((item) => item.key === selectedVideoKey) ?? playableVideos[0] ?? null;
  const activePreviewUrl = activeVideo?.previewUrl ?? (mediaVisible ? ad.preview_url : null);
  const activeFileId = activeVideo?.driveFileId ?? (mediaVisible ? ad.drive_file_id : null);
  const thumbnailSrc = mediaVisible ? resolveAdThumbnailUrl(activeVideo?.isMain ? ad.thumbnail_url : null, activeFileId) : null;
  const variationPairs = buildVariationPairs(ad.variations, ad.edited_variations, true, mediaVisible);
  const details: { label: string; value: React.ReactNode }[] = [
    { label: "Stage", value: productionStageLabels[ad.production_stage] ?? ad.production_stage },
    { label: "Campaign", value: ad.campaigns?.map((item) => item.name).join(", ") || ad.campaign?.name || "No campaign" },
    { label: "Product", value: ad.product?.name ?? "—" },
    { label: "Platforms", value: ad.platforms.length ? ad.platforms.join(", ") : "—" },
    { label: "Deadline", value: ad.deadline ? <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" aria-hidden />{formatDateOnly(ad.deadline)}</span> : "—" },
    { label: "Tags", value: ad.tags.length ? ad.tags.filter((tag) => tag.name.toLowerCase() !== "downloaded").map((tag) => `#${tag.name}`).join(" ") || "—" : "—" }
  ];

  return (
    <Modal open labelledBy="preview-title" onClose={onClose} className="p-0 sm:p-6">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden border border-border bg-card shadow-float sm:rounded-xl dark:shadow-none" onClick={(event) => event.stopPropagation()}>
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="preview-title" className="truncate text-lg font-semibold text-foreground">{ad.name}</h2>
              <StatusBadge status={ad.status} />
              <ProductionStageBadge stage={ad.production_stage} className="bg-muted text-muted-foreground shadow-none" />
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {ad.creator ? <Avatar name={ad.creator.name} src={ad.creator.avatar_url} className="size-6" /> : null}
              <span>{ad.creator?.name ?? "Unknown creator"}</span>
              <span className="text-border">/</span>
              <span>Edited by {ad.editor?.name ?? "Unassigned"}</span>
              <span className="hidden text-border sm:inline">/</span>
              <span className="hidden truncate sm:inline">{ad.campaigns?.map((item) => item.name).join(", ") || ad.campaign?.name || "No campaign"}</span>
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
          <div className="flex min-h-[300px] flex-col bg-neutral-950 lg:min-h-0">
            {mediaVisible && playableVideos.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card/95 px-3 py-2">
                {playableVideos.map((video) => {
                  const selected = activeVideo?.key === video.key;
                  return (
                    <button
                      key={video.key}
                      type="button"
                      onClick={() => setSelectedVideoKey(video.key)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Play className="size-3" aria-hidden />
                      {video.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              {mediaVisible && activePreviewUrl ? (
                <iframe key={activeVideo?.key ?? "main"} src={activePreviewUrl} title={`${ad.name} - ${activeVideo?.label ?? "Video"}`} className="h-full min-h-[280px] w-full" allow="autoplay" />
              ) : mediaVisible && activeFileId ? (
                <video
                  key={activeFileId}
                  src={`/api/ads/${ad.id}/media?fileId=${encodeURIComponent(activeFileId)}`}
                  controls
                  autoPlay
                  playsInline
                  className="h-full min-h-[280px] w-full bg-black object-contain"
                />
              ) : thumbnailSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnailSrc} alt="" className="h-full min-h-[280px] w-full object-contain" />
              ) : !mediaVisible ? (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
                  <span className="flex size-12 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"><Clapperboard className="size-5" aria-hidden /></span>
                  <p className="text-sm font-semibold text-foreground">{productionStageLabels[ad.production_stage] ?? "In production"}</p>
                  <p className="max-w-sm text-sm text-muted-foreground">{pendingMediaCopy[ad.production_stage] ?? "The video isn't available yet."}</p>
                </div>
              ) : (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground"><Video className="size-7" aria-hidden />Preview unavailable</div>
              )}
            </div>
          </div>
          <aside className="min-h-0 border-t border-border p-5 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:p-6">
            {(ad.production_stage === "creator_changes_requested" || ad.production_stage === "changes_requested") ? (
              <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
                <p className="font-semibold text-warning">
                  {ad.production_stage === "creator_changes_requested"
                    ? `Changes requested to Content Creator (${ad.creator?.name ?? "Creator"})`
                    : `Changes requested to Video Editor (${ad.editor?.name ?? "Editor"})`}
                </p>
                {ad.latest_change_request?.note ? (
                  <p className="mt-1 text-foreground">&ldquo;{ad.latest_change_request.note}&rdquo;</p>
                ) : null}
                {ad.latest_change_request?.reviewer?.name ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Requested by {ad.latest_change_request.reviewer.name}
                  </p>
                ) : null}
              </div>
            ) : null}
            <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-muted/40 p-3 text-xs">
              {details.map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase text-muted-foreground">{item.label}</dt>
                  <dd className="mt-0.5 truncate font-medium text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
            {variationPairs.length > 0 ? (
              <div className="mb-5 rounded-lg border border-border p-3 text-xs">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Variations ({variationPairs.length})
                </p>
                <ul className="mt-2 space-y-2">
                  {variationPairs.map((pair, idx) => {
                    const playableMatch = playableVideos.find(
                      (video) => !video.isMain && ((pair.driveFileId && video.driveFileId === pair.driveFileId) || video.label === pair.label || video.key.endsWith(`-${idx}`))
                    );
                    const isActive = playableMatch && activeVideo?.key === playableMatch.key;
                    return (
                      <li key={pair.key} className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-foreground">{pair.label}</span>
                        <span className="flex shrink-0 items-center gap-2.5 font-medium">
                          {playableMatch ? (
                            <button
                              type="button"
                              onClick={() => setSelectedVideoKey(playableMatch.key)}
                              className={cn(
                                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
                                isActive
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-foreground hover:bg-primary/15 hover:text-primary"
                              )}
                            >
                              <Play className="size-3" aria-hidden />
                              {isActive ? "Playing" : "Watch"}
                            </button>
                          ) : null}
                          {pair.rawUrl ? (
                            <a
                              href={pair.rawUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary hover:underline"
                            >
                              Raw <ExternalLink className="size-3" aria-hidden />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">Raw pending</span>
                          )}
                          {mediaVisible && pair.editedUrl ? (
                            <a
                              href={pair.editedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              Edited <ExternalLink className="size-3" aria-hidden />
                            </a>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {showFreeze || showUnfreezeOverride ? (
              <div className="mb-5 rounded-lg border border-border p-3">
                <h3 className="section-heading">Editing controls</h3>
                <div className="mt-3 flex flex-col gap-3">
                  {showFreeze ? (
                    <FreezeEditingToggle
                      adId={ad.id}
                      adName={ad.name}
                      stage={ad.production_stage}
                      state={ad.editing_freeze}
                      onChanged={(state, stage) => onFreezeChange?.(ad.id, state, stage)}
                    />
                  ) : null}
                  {showUnfreezeOverride ? (
                    <div>
                      <UnfreezeEditingButton
                        ad={ad}
                        onDone={() => {
                          onFreezeChange?.(ad.id, "unfrozen", "editing");
                          onClose();
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {ad.notes ? (
              <div className="mb-5">
                <h3 className="section-heading">Notes</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{ad.notes}</p>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3"><h3 className="section-heading">Script</h3><span className="text-xs text-muted-foreground">{ad.script_text?.split(/\s+/).filter(Boolean).length ?? 0} words</span></div>
            <div
              className="prose-script mt-4 text-sm"
              dangerouslySetInnerHTML={{
                __html:
                  ad.script_html ||
                  (ad.script_text
                    ? `<p>${ad.script_text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`
                    : "<p>No script added.</p>")
              }}
            />
          </aside>
        </div>
      </div>
    </Modal>
  );
}
