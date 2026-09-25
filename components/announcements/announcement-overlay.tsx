"use client";

import React, { useState, useEffect, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  Megaphone,
  Paperclip,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Announcement, AnnouncementAttachment } from "@/lib/announcements";
import type { Profile } from "@/lib/types";
import { acknowledgeAnnouncement, getPendingAnnouncements } from "@/app/actions/announcements";
import { getAttachmentIcon, formatFileSize } from "./announcement-card";
export function AnnouncementPopupModal({
  announcement,
  onClose,
  onAcknowledge,
  isAcknowledging = false,
  isPreview = false,
  currentIndex,
  totalCount,
  onPublish,
  isPublishing = false
}: {
  announcement: Announcement;
  onClose?: () => void;
  onAcknowledge?: () => void;
  isAcknowledging?: boolean;
  isPreview?: boolean;
  currentIndex?: number;
  totalCount?: number;
  onPublish?: () => void;
  isPublishing?: boolean;
}) {
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const formattedDate = announcement.created_at
    ? new Date(announcement.created_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "Just now";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-title"
    >
      {/* 90% viewport container */}
      <div className="relative flex flex-col w-[90vw] h-[90vh] max-w-5xl max-h-[90vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Banner Header */}
        <div className="flex items-center justify-between border-b border-border bg-muted/60 px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-2xs">
              <Megaphone className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  {isPreview ? "Official Announcement (Preview)" : "Official Announcement"}
                </span>
                {totalCount && totalCount > 1 && currentIndex !== undefined ? (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {currentIndex + 1} of {totalCount}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                From <span className="font-semibold text-foreground">{announcement.author_name}</span> (
                {announcement.author_role === "admin" ? "Administrator" : "Manager"}) · {formattedDate}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isPreview ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Eye className="size-3.5" />
                Popup Modal Preview
              </span>
            ) : (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                <AlertCircle className="size-3.5" />
                Action required: Read &amp; Acknowledge
              </span>
            )}
            {onClose ? (
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                className="size-9 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                title="Close"
              >
                <X className="size-5" />
              </Button>
            ) : null}
          </div>
        </div>

        {/* Scrollable Content Body with EXACT REQUESTED HIERARCHY */}
        <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-8 space-y-6">
          {/* 1. TOP PART: CENTRED IMAGE */}
          {announcement.images && announcement.images.length > 0 ? (
            <div className="flex flex-col items-center justify-center w-full">
              <div className="w-full flex flex-col items-center gap-4">
                {announcement.images.map((imgSrc, idx) => (
                  <div
                    key={idx}
                    onClick={() => setImagePreview(imgSrc)}
                    className="group relative max-w-full sm:max-w-2xl max-h-[420px] rounded-xl border border-border bg-muted/20 overflow-hidden cursor-pointer shadow-soft hover:border-primary/50 transition-all flex items-center justify-center"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgSrc}
                      alt={`Announcement visual ${idx + 1}`}
                      className="max-h-[420px] w-auto max-w-full object-contain mx-auto transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold">
                      <Eye className="size-4" /> Click to enlarge
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 2. BENEATH IMAGE: HEADING */}
          <div className="space-y-1">
            <h1
              id="announcement-title"
              className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-snug"
            >
              {announcement.title || "(Untitled Announcement)"}
            </h1>
          </div>

          {/* 3. BENEATH HEADING: BODY OF THE ANNOUNCEMENT */}
          <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 whitespace-pre-wrap leading-relaxed text-sm sm:text-base border-l-2 border-primary/40 pl-4 py-1">
            {announcement.content || "(No message content)"}
          </div>

          {/* 4. BENEATH BODY: ATTACHMENTS THAT ONE CAN DOWNLOAD */}
          {announcement.attachments && announcement.attachments.length > 0 ? (
            <div className="space-y-3 pt-3 border-t border-border">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Paperclip className="size-4 text-primary" />
                Downloadable Attachments ({announcement.attachments.length})
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {announcement.attachments.map((att: AnnouncementAttachment) => {
                  const icon = getAttachmentIcon(att.name, att.type);
                  const sizeLabel = formatFileSize(att.size);

                  return (
                    <a
                      key={att.id}
                      href={att.url}
                      download={att.name}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-xl border border-border bg-card p-3.5 hover:bg-muted/60 hover:border-primary/40 transition-all group shadow-2xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          {icon}
                        </div>
                        <div className="min-w-0 truncate">
                          <p className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors truncate">
                            {att.name}
                          </p>
                          {sizeLabel ? (
                            <p className="text-[11px] text-muted-foreground mt-0.5">{sizeLabel}</p>
                          ) : null}
                        </div>
                      </div>

                      <div
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/15 group-hover:text-primary transition-colors"
                        title="Download file"
                      >
                        <Download className="size-4" />
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border bg-card/95 backdrop-blur px-6 py-4 sm:px-8 shrink-0">
          <p className="text-xs text-muted-foreground text-center sm:text-left">
            {isPreview ? (
              <span>
                Previewing modal popup. Targeted team members will see this until they click{" "}
                <strong className="text-foreground">OK</strong>.
              </span>
            ) : (
              <span>
                By clicking <strong className="text-foreground">OK</strong>, you confirm you have read and acknowledged this announcement.
              </span>
            )}
          </p>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {isPreview ? (
              <>
                {onClose ? (
                  <Button size="md" variant="secondary" onClick={onClose} className="flex-1 sm:flex-none">
                    Back to Edit
                  </Button>
                ) : null}
                {onPublish ? (
                  <Button
                    size="md"
                    onClick={onPublish}
                    disabled={isPublishing}
                    className="flex-1 sm:flex-none gap-2 font-bold"
                  >
                    {isPublishing ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
                    Publish Announcement
                  </Button>
                ) : (
                  <Button size="md" variant="primary" onClick={onClose} className="flex-1 sm:flex-none">
                    Close Preview
                  </Button>
                )}
              </>
            ) : (
              <Button
                size="md"
                onClick={onAcknowledge}
                disabled={isAcknowledging}
                className="w-full sm:w-auto min-w-[200px] h-12 text-sm font-bold shadow-soft flex items-center justify-center gap-2"
              >
                {isAcknowledging ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                OK, I Acknowledge
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen Image Preview Dialog */}
      {imagePreview ? (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/95 p-4"
          onClick={() => setImagePreview(null)}
        >
          <button
            type="button"
            onClick={() => setImagePreview(null)}
            className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-card/80 text-foreground hover:bg-card transition-colors"
            title="Close image"
          >
            <X className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imagePreview}
            alt="Preview"
            className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

export function AnnouncementOverlay({ profile }: { profile: Profile }) {
  const [pendingList, setPendingList] = useState<Announcement[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPending, startTransition] = useTransition();

  const loadPending = async () => {
    try {
      const announcements = await getPendingAnnouncements();
      if (Array.isArray(announcements)) {
        setPendingList(announcements);
        setCurrentIndex((prev) => (prev >= announcements.length ? 0 : prev));
      }
    } catch (e) {
      console.error("Failed to load pending announcements:", e);
    }
  };

  useEffect(() => {
    void loadPending();

    // 1. Supabase Realtime Channel
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`announcements-overlay-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () => {
        void loadPending();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "announcement_acknowledgements" }, () => {
        void loadPending();
      })
      .subscribe();

    // 2. BroadcastChannel cross-tab listener
    let bc: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      bc = new BroadcastChannel("adflow_announcements");
      bc.onmessage = () => {
        void loadPending();
      };
    }

    // 3. Custom event listener (within same tab)
    const handleCustomEvent = () => {
      void loadPending();
    };
    window.addEventListener("adflow:announcement-updated", handleCustomEvent);

    // 4. Background polling fallback every 4 seconds when page is visible
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadPending();
      }
    }, 4000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadPending();
    };
    const onFocus = () => void loadPending();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("adflow:announcement-updated", handleCustomEvent);
      if (bc) bc.close();
      void supabase.removeChannel(channel);
    };
  }, [profile.id]);

  const activeAnnouncement = pendingList[currentIndex];
  if (!activeAnnouncement) return null;

  const handleAcknowledge = () => {
    startTransition(async () => {
      const res = await acknowledgeAnnouncement(activeAnnouncement.id);
      if (res.ok) {
        setPendingList((prev) => {
          const next = [...prev];
          next.splice(currentIndex, 1);
          return next;
        });

        // Broadcast to other components and tabs immediately
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("adflow:announcement-updated"));
          if ("BroadcastChannel" in window) {
            const bc = new BroadcastChannel("adflow_announcements");
            bc.postMessage({ type: "ACK", announcementId: activeAnnouncement.id, userId: profile.id });
            bc.close();
          }
        }
      }
    });
  };

  return (
    <AnnouncementPopupModal
      announcement={activeAnnouncement}
      currentIndex={currentIndex}
      totalCount={pendingList.length}
      onAcknowledge={handleAcknowledge}
      isAcknowledging={isPending}
    />
  );
}
