"use client";

import React, { useState, useEffect, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileText,
  ImageIcon,
  Loader2,
  Megaphone,
  Paperclip,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Announcement } from "@/lib/announcements";
import type { Profile } from "@/lib/types";
import { acknowledgeAnnouncement, getPendingAnnouncements } from "@/app/actions/announcements";

export function AnnouncementOverlay({ profile }: { profile: Profile }) {
  const [pendingList, setPendingList] = useState<Announcement[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const announcements = await getPendingAnnouncements();
        if (mounted && Array.isArray(announcements)) {
          setPendingList(announcements);
          setCurrentIndex(0);
        }
      } catch (e) {
        console.error("Failed to load announcements:", e);
      }
    }
    void load();
    return () => {
      mounted = false;
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
      }
    });
  };

  const formattedDate = new Date(activeAnnouncement.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-title"
    >
      {/* 90% viewport container */}
      <div className="relative flex flex-col w-[90vw] h-[90vh] max-w-6xl max-h-[90vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Banner Header */}
        <div className="flex items-center justify-between border-b border-border bg-muted/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-2xs">
              <Megaphone className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  Official Announcement
                </span>
                {pendingList.length > 1 ? (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {currentIndex + 1} of {pendingList.length}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                From <span className="font-semibold text-foreground">{activeAnnouncement.author_name}</span> (
                {activeAnnouncement.author_role === "admin" ? "Administrator" : "Manager"}) · {formattedDate}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
              <AlertCircle className="size-3.5" />
              Action required: Read &amp; Acknowledge
            </span>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-8 space-y-6">
          <div>
            <h1 id="announcement-title" className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-snug">
              {activeAnnouncement.title}
            </h1>
          </div>

          {/* Formatted Message */}
          <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 whitespace-pre-wrap leading-relaxed text-sm sm:text-base border-l-2 border-primary/40 pl-4 py-1">
            {activeAnnouncement.content}
          </div>

          {/* Inline Images Gallery */}
          {activeAnnouncement.images && activeAnnouncement.images.length > 0 ? (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <ImageIcon className="size-4 text-primary" />
                Attached Images ({activeAnnouncement.images.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeAnnouncement.images.map((imgSrc, idx) => (
                  <div
                    key={idx}
                    onClick={() => setImagePreview(imgSrc)}
                    className="group relative aspect-video rounded-xl border border-border bg-muted/40 overflow-hidden cursor-pointer shadow-xs hover:border-primary/50 transition-all"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgSrc}
                      alt={`Announcement image ${idx + 1}`}
                      className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-medium">
                      <Eye className="size-4" /> Click to enlarge
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Attachments Section */}
          {activeAnnouncement.attachments && activeAnnouncement.attachments.length > 0 ? (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Paperclip className="size-4 text-primary" />
                Attachments ({activeAnnouncement.attachments.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {activeAnnouncement.attachments.map((att) => (
                  <a
                    key={att.id}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-xl border border-border bg-card p-3.5 hover:bg-muted/60 hover:border-primary/40 transition-all group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <FileText className="size-4" />
                      </div>
                      <div className="min-w-0 truncate">
                        <p className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors truncate">
                          {att.name}
                        </p>
                        {att.size ? (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {(att.size / 1024).toFixed(0)} KB
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex size-7 items-center justify-center rounded text-muted-foreground group-hover:text-primary">
                      <Download className="size-4" />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer with mandatory OK button */}
        <div className="sticky bottom-0 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border bg-card/95 backdrop-blur px-6 py-4 sm:px-8">
          <p className="text-xs text-muted-foreground text-center sm:text-left">
            By clicking <strong className="text-foreground">OK</strong>, you confirm you have read and acknowledged this announcement.
          </p>

          <Button
            size="md"
            onClick={handleAcknowledge}
            disabled={isPending}
            className="w-full sm:w-auto min-w-[200px] h-12 text-sm font-bold shadow-soft flex items-center justify-center gap-2"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            OK, I Acknowledge
          </Button>
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
