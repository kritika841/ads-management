"use client";

import React, { useState, useEffect, useTransition } from "react";
import {
  Bell,
  CheckCircle2,
  Megaphone,
  Search,
  X
} from "lucide-react";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Announcement } from "@/lib/announcements";
import type { Profile } from "@/lib/types";
import { acknowledgeAnnouncement, getUserAnnouncements } from "@/app/actions/announcements";
import { AnnouncementCardView } from "./announcement-card";
import { AnnouncementPopupModal } from "./announcement-overlay";

export function UserAnnouncementsFeed({
  initialAnnouncements,
  profile
}: {
  initialAnnouncements: Announcement[];
  profile: Profile;
}) {
  const { toast } = useToast();
  const [announcements, setAnnouncements] = useState<Announcement[]>(initialAnnouncements);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterState, setFilterState] = useState<"all" | "pending" | "acknowledged">("all");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [popupAnnouncement, setPopupAnnouncement] = useState<Announcement | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Function to refresh announcements in real-time
  const refreshAnnouncements = async () => {
    try {
      const data = await getUserAnnouncements();
      if (Array.isArray(data)) {
        setAnnouncements(data);
      }
    } catch (e) {
      console.error("Failed to refresh user announcements:", e);
    }
  };

  useEffect(() => {
    // 1. Supabase Realtime channel
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`user-announcements-feed-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () => {
        void refreshAnnouncements();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "announcement_acknowledgements" }, () => {
        void refreshAnnouncements();
      })
      .subscribe();

    // 2. BroadcastChannel cross-tab listener
    let bc: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      bc = new BroadcastChannel("adflow_announcements");
      bc.onmessage = () => {
        void refreshAnnouncements();
      };
    }

    // 3. Custom event listener (within same tab)
    const handleCustomEvent = () => {
      void refreshAnnouncements();
    };
    window.addEventListener("adflow:announcement-updated", handleCustomEvent);

    // 4. Background polling fallback every 4 seconds when page is visible
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshAnnouncements();
      }
    }, 4000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshAnnouncements();
    };
    const onFocus = () => void refreshAnnouncements();

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

  const handleAcknowledge = (announcementId: string) => {
    setAcknowledgingId(announcementId);
    startTransition(async () => {
      try {
        const res = await acknowledgeAnnouncement(announcementId);
        if (res.ok) {
          toast({
            title: "Announcement acknowledged",
            description: "Thank you for confirming receipt of this update.",
            tone: "success"
          });

          // Optimistically update local state
          setAnnouncements((prev) =>
            prev.map((ann) => {
              if (ann.id !== announcementId) return ann;
              const alreadyAck = ann.acknowledgements?.some((a) => a.user_id === profile.id);
              if (alreadyAck) return ann;
              return {
                ...ann,
                acknowledgements: [
                  ...(ann.acknowledgements || []),
                  {
                    user_id: profile.id,
                    user_name: profile.name,
                    user_role: profile.role,
                    acknowledged_at: new Date().toISOString()
                  }
                ]
              };
            })
          );

          // Broadcast to other tabs & components
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("adflow:announcement-updated"));
            if ("BroadcastChannel" in window) {
              const bc = new BroadcastChannel("adflow_announcements");
              bc.postMessage({ type: "ACK", announcementId, userId: profile.id });
              bc.close();
            }
          }
        } else {
          toast({
            title: "Failed to acknowledge",
            description: res.message || "Please try again.",
            tone: "error"
          });
        }
      } finally {
        setAcknowledgingId(null);
      }
    });
  };

  const filteredAnnouncements = announcements.filter((ann) => {
    const isAck = ann.acknowledgements?.some((a) => a.user_id === profile.id);
    if (filterState === "pending" && isAck) return false;
    if (filterState === "acknowledged" && !isAck) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = ann.title.toLowerCase().includes(q);
      const matchContent = ann.content.toLowerCase().includes(q);
      const matchAuthor = ann.author_name.toLowerCase().includes(q);
      if (!matchTitle && !matchContent && !matchAuthor) return false;
    }

    return true;
  });

  const pendingCount = announcements.filter(
    (a) => !a.acknowledgements?.some((ack) => ack.user_id === profile.id)
  ).length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-2xs">
              <Megaphone className="size-5" />
            </span>
            Announcements &amp; Updates
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Official announcements, guidelines, and resource updates from management.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {pendingCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning border border-warning/30">
              <Bell className="size-3.5" /> {pendingCount} pending acknowledgement
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success border border-success/30">
              <CheckCircle2 className="size-3.5" /> All caught up
            </span>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border rounded-xl p-3 shadow-2xs">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search announcements..."
            className="h-8 text-xs bg-background"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterState("all")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
              filterState === "all"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            All ({announcements.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterState("pending")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
              filterState === "pending"
                ? "bg-warning text-warning-foreground shadow-2xs"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterState("acknowledged")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
              filterState === "acknowledged"
                ? "bg-success text-success-foreground shadow-2xs"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            Acknowledged ({announcements.length - pendingCount})
          </button>
        </div>
      </div>

      {/* List of Announcements */}
      <div className="space-y-6">
        {filteredAnnouncements.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted mx-auto text-muted-foreground mb-3">
              <Megaphone className="size-6" />
            </div>
            <h3 className="text-base font-bold text-foreground">No announcements found</h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
              {searchQuery
                ? "No announcements matched your search filter."
                : "There are currently no active announcements targeted to you. You're completely up to date!"}
            </p>
          </div>
        ) : (
          filteredAnnouncements.map((ann) => (
            <AnnouncementCardView
              key={ann.id}
              announcement={ann}
              userId={profile.id}
              onImageClick={(url) => setImagePreview(url)}
              onAcknowledge={handleAcknowledge}
              onShowPopup={() => setPopupAnnouncement(ann)}
              isAcknowledging={acknowledgingId === ann.id}
              showAcknowledgementBanner={true}
            />
          ))
        )}
      </div>

      {/* Interactive Announcement Popup Modal */}
      {popupAnnouncement ? (
        <AnnouncementPopupModal
          announcement={popupAnnouncement}
          onClose={() => setPopupAnnouncement(null)}
          onAcknowledge={() => handleAcknowledge(popupAnnouncement.id)}
          isAcknowledging={acknowledgingId === popupAnnouncement.id}
        />
      ) : null}

      {/* Fullscreen Image Preview Dialog */}
      {imagePreview ? (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setImagePreview(null)}
        >
          <button
            type="button"
            onClick={() => setImagePreview(null)}
            className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-card/80 text-foreground hover:bg-card transition-colors shadow-lg"
            title="Close image preview"
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
