"use client";

import React from "react";
import {
  Archive,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  Music,
  Paperclip,
  Video
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Announcement, AnnouncementAttachment } from "@/lib/announcements";

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getAttachmentIcon(filename: string, type?: string) {
  const name = filename.toLowerCase();
  const mime = (type || "").toLowerCase();

  if (
    mime.startsWith("audio/") ||
    name.endsWith(".mp3") ||
    name.endsWith(".wav") ||
    name.endsWith(".m4a") ||
    name.endsWith(".ogg") ||
    name.endsWith(".aac") ||
    name.endsWith(".flac")
  ) {
    return <Music className="size-5" />;
  }

  if (
    mime.startsWith("video/") ||
    name.endsWith(".mp4") ||
    name.endsWith(".mov") ||
    name.endsWith(".avi") ||
    name.endsWith(".mkv") ||
    name.endsWith(".webm")
  ) {
    return <Video className="size-5" />;
  }

  if (
    mime.startsWith("image/") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".gif") ||
    name.endsWith(".webp")
  ) {
    return <ImageIcon className="size-5" />;
  }

  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    return <FileText className="size-5" />;
  }

  if (
    name.endsWith(".zip") ||
    name.endsWith(".rar") ||
    name.endsWith(".7z") ||
    name.endsWith(".tar") ||
    name.endsWith(".gz")
  ) {
    return <Archive className="size-5" />;
  }

  return <Paperclip className="size-5" />;
}

export function AnnouncementCardView({
  announcement,
  userId,
  onImageClick,
  onAcknowledge,
  isAcknowledging = false,
  showAcknowledgementBanner = true
}: {
  announcement: Announcement;
  userId?: string;
  onImageClick?: (url: string) => void;
  onAcknowledge?: (announcementId: string) => void;
  isAcknowledging?: boolean;
  showAcknowledgementBanner?: boolean;
}) {
  const formattedDate = new Date(announcement.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const ackRecord = userId
    ? announcement.acknowledgements?.find((a) => a.user_id === userId)
    : null;
  const hasAcknowledged = Boolean(ackRecord);

  return (
    <article className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-soft flex flex-col space-y-6">
      {/* 1. TOP PART: CENTRED IMAGE */}
      {announcement.images && announcement.images.length > 0 ? (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="w-full flex flex-col items-center gap-4">
            {announcement.images.map((imgSrc, idx) => (
              <div
                key={idx}
                onClick={() => onImageClick?.(imgSrc)}
                className="group relative max-w-full sm:max-w-2xl max-h-[440px] rounded-xl border border-border bg-muted/20 overflow-hidden cursor-pointer shadow-xs hover:border-primary/50 transition-all flex items-center justify-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt={`Announcement visual ${idx + 1}`}
                  className="max-h-[440px] w-auto max-w-full object-contain mx-auto transition-transform duration-200 group-hover:scale-[1.02]"
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
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{announcement.author_name}</span>
          <span className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
            {announcement.author_role === "admin" ? "Admin" : "Manager"}
          </span>
          <span>·</span>
          <span>{formattedDate}</span>
          {announcement.status === "archived" ? (
            <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              Archived
            </span>
          ) : (
            <span className="rounded-full bg-success/15 text-success px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              Active
            </span>
          )}
        </div>

        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-snug">
          {announcement.title}
        </h2>
      </div>

      {/* 3. BENEATH HEADING: BODY OF THE ANNOUNCEMENT */}
      <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 whitespace-pre-wrap leading-relaxed text-sm sm:text-base border-l-2 border-primary/40 pl-4 py-1">
        {announcement.content}
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

      {/* Acknowledgement Status / Action Footer (if applicable) */}
      {showAcknowledgementBanner && userId && announcement.status === "active" ? (
        <div className="pt-4 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-muted/20 p-4 rounded-xl">
          {hasAcknowledged ? (
            <div className="flex items-center gap-2 text-xs text-success font-medium">
              <CheckCircle2 className="size-4 text-success shrink-0" />
              <span>
                Acknowledged on{" "}
                {new Date(ackRecord!.acknowledged_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-warning font-medium">
              <Clock className="size-4 text-warning shrink-0" />
              <span>Acknowledgement pending</span>
            </div>
          )}

          {!hasAcknowledged && onAcknowledge ? (
            <Button
              size="sm"
              onClick={() => onAcknowledge(announcement.id)}
              disabled={isAcknowledging}
              className="gap-2 font-bold shadow-2xs w-full sm:w-auto"
            >
              {isAcknowledging ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              Confirm Acknowledged
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
