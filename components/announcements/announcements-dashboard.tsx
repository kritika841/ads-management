"use client";

import React, { useState, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  CheckCircle2,
  Clock,
  Eye,
  Grid,
  Image as ImageIcon,
  LayoutList,
  Loader2,
  Megaphone,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UploadCloud,
  Users,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Announcement, AnnouncementAttachment, AnnouncementTargetType } from "@/lib/announcements";
import type { Profile } from "@/lib/types";
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncementsWithStats,
  unarchiveAnnouncement
} from "@/app/actions/announcements";
import {
  AnnouncementCardView,
  formatFileSize,
  getAttachmentIcon
} from "./announcement-card";

export function AnnouncementsDashboard({
  announcements: initialAnnouncements,
  allProfiles,
  profile
}: {
  announcements: Announcement[];
  allProfiles: Profile[];
  profile: Profile;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [announcements, setAnnouncements] = useState<Announcement[]>(initialAnnouncements);
  const [viewMode, setViewMode] = useState<"table" | "feed">("table");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [previewAnnouncement, setPreviewAnnouncement] = useState<Announcement | null>(null);
  const [inspectorAnnouncement, setInspectorAnnouncement] = useState<Announcement | null>(null);
  const [inspectorFilter, setInspectorFilter] = useState<"all" | "acknowledged" | "pending">("all");
  const [inspectorSearch, setInspectorSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("all");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Create form state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [targetType, setTargetType] = useState<AnnouncementTargetType>("roles");
  const [targetRoles, setTargetRoles] = useState<("content_creator" | "editor" | "manager")[]>([
    "content_creator",
    "editor"
  ]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const isAdmin = profile.role === "admin";

  // Function to refresh announcements in real-time
  const refreshAnnouncements = async () => {
    try {
      const res = await getAnnouncementsWithStats();
      if (res.ok && Array.isArray(res.announcements)) {
        setAnnouncements(res.announcements);

        // Keep inspector announcement in sync with latest acknowledgements
        setInspectorAnnouncement((current) => {
          if (!current) return null;
          const updated = res.announcements.find((a) => a.id === current.id);
          return updated || current;
        });

        // Keep preview announcement in sync
        setPreviewAnnouncement((current) => {
          if (!current) return null;
          const updated = res.announcements.find((a) => a.id === current.id);
          return updated || current;
        });
      }
    } catch (e) {
      console.error("Failed to refresh announcements:", e);
    }
  };

  // Real-time synchronization: Supabase realtime + BroadcastChannel + Polling fallback
  useEffect(() => {
    // 1. Supabase Realtime channel
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`admin-announcements-${profile.id}`)
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

  // Helper to determine target users for an announcement
  const getTargetUsersForAnnouncement = (ann: Announcement): Profile[] => {
    const activeProfiles = allProfiles.filter((p) => p.active);
    if (ann.target_type === "all") {
      return activeProfiles.filter((p) => p.role !== "admin");
    }
    if (ann.target_type === "roles") {
      return activeProfiles.filter((p) =>
        ann.target_roles.includes(p.role as ("content_creator" | "editor" | "manager"))
      );
    }
    if (ann.target_type === "users") {
      return activeProfiles.filter((p) => ann.target_user_ids.includes(p.id));
    }
    return [];
  };

  // Metrics
  const totalAnnouncements = announcements.length;
  const activeAnnouncements = announcements.filter((a) => a.status === "active").length;
  const archivedAnnouncements = announcements.filter((a) => a.status === "archived").length;

  const filteredAnnouncements = useMemo(() => {
    return announcements.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = a.title.toLowerCase().includes(q);
        const matchContent = a.content.toLowerCase().includes(q);
        const matchAuthor = a.author_name.toLowerCase().includes(q);
        if (!matchTitle && !matchContent && !matchAuthor) return false;
      }
      return true;
    });
  }, [announcements, statusFilter, searchQuery]);

  // Handle image upload from file or URL
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
          setImages((prev) => [...prev, result]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAddImageUrl = () => {
    if (!imageUrlInput.trim()) return;
    setImages((prev) => [...prev, imageUrlInput.trim()]);
    setImageUrlInput("");
  };

  // Handle direct file upload for attachments of ANY type up to 30 MB
  const handleAttachmentFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const MAX_SIZE = 30 * 1024 * 1024; // 30 MB

    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        toast({
          title: "File too large",
          description: `"${file.name}" (${sizeMb} MB) exceeds the 30 MB maximum size limit.`,
          tone: "error"
        });
        continue;
      }

      setUploadingAttachment(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("filename", file.name);

        const response = await fetch("/api/announcements/attachments", {
          method: "POST",
          body: formData
        });

        const result = await response.json();
        if (!response.ok || !result.ok) {
          toast({
            title: "Upload failed",
            description: result.error || `Could not upload "${file.name}".`,
            tone: "error"
          });
        } else {
          setAttachments((prev) => [...prev, result.attachment]);
          toast({
            title: "Attachment uploaded",
            description: `"${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) attached.`,
            tone: "success"
          });
        }
      } catch (err) {
        console.error("Upload error:", err);
        toast({
          title: "Upload failed",
          description: `Failed to upload "${file.name}".`,
          tone: "error"
        });
      } finally {
        setUploadingAttachment(false);
      }
    }

    // Reset input
    e.target.value = "";
  };

  // Add attachment from external URL or link
  const handleAddAttachment = () => {
    if (!attachmentName.trim() || !attachmentUrl.trim()) return;
    setAttachments((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: attachmentName.trim(),
        url: attachmentUrl.trim()
      }
    ]);
    setAttachmentName("");
    setAttachmentUrl("");
  };

  const resetCreateForm = () => {
    setTitle("");
    setContent("");
    setTargetType("roles");
    setTargetRoles(["content_creator", "editor"]);
    setSelectedUserIds([]);
    setImages([]);
    setImageUrlInput("");
    setAttachments([]);
    setAttachmentName("");
    setAttachmentUrl("");
  };

  const broadcastChange = (type: string, data?: unknown) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("adflow:announcement-updated"));
      if ("BroadcastChannel" in window) {
        const bc = new BroadcastChannel("adflow_announcements");
        bc.postMessage({ type, data });
        bc.close();
      }
    }
  };

  const handleCreateAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      toast({ title: "Missing fields", description: "Title and message content are required.", tone: "error" });
      return;
    }

    startTransition(async () => {
      const res = await createAnnouncement({
        title: title.trim(),
        content: content.trim(),
        images,
        attachments,
        targetType,
        targetRoles: targetType === "roles" ? targetRoles : undefined,
        targetUserIds: targetType === "users" ? selectedUserIds : undefined
      });

      if (!res.ok || !res.announcement) {
        toast({ title: "Failed to create", description: res.message ?? "Could not save announcement.", tone: "error" });
        return;
      }

      toast({
        title: "Announcement published",
        description: "Targeted users will receive the announcement without refreshing.",
        tone: "success"
      });
      setAnnouncements((prev) => [res.announcement!, ...prev]);
      setCreateModalOpen(false);
      resetCreateForm();
      broadcastChange("CREATE", res.announcement);
      router.refresh();
    });
  };

  const handleArchive = (id: string) => {
    startTransition(async () => {
      const res = await archiveAnnouncement(id);
      if (res.ok) {
        setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, status: "archived" } : a)));
        toast({
          title: "Announcement archived",
          description: "Targeted users will no longer be prompted by this announcement.",
          tone: "success"
        });
        broadcastChange("STATUS_CHANGE", { id, status: "archived" });
      }
    });
  };

  const handleUnarchive = (id: string) => {
    startTransition(async () => {
      const res = await unarchiveAnnouncement(id);
      if (res.ok) {
        setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, status: "active" } : a)));
        toast({
          title: "Announcement restored",
          description: "Announcement is now active and prompting targeted users.",
          tone: "success"
        });
        broadcastChange("STATUS_CHANGE", { id, status: "active" });
      }
    });
  };

  const handleDelete = (id: string, annTitle: string) => {
    if (!confirm(`Delete announcement "${annTitle}" permanently?`)) return;
    startTransition(async () => {
      const res = await deleteAnnouncement(id);
      if (res.ok) {
        setAnnouncements((prev) => prev.filter((a) => a.id !== id));
        toast({ title: "Announcement deleted", description: annTitle, tone: "success" });
        broadcastChange("DELETE", { id });
      }
    });
  };

  // Inspector users breakdown calculation
  const inspectorTargetUsers = useMemo(() => {
    return inspectorAnnouncement ? getTargetUsersForAnnouncement(inspectorAnnouncement) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectorAnnouncement, allProfiles]);

  const inspectorAckMap = useMemo(() => {
    return new Map(
      (inspectorAnnouncement?.acknowledgements ?? []).map((a) => [a.user_id, a])
    );
  }, [inspectorAnnouncement]);

  const filteredInspectorUsers = useMemo(() => {
    return inspectorTargetUsers.filter((u) => {
      const isAck = inspectorAckMap.has(u.id);
      if (inspectorFilter === "acknowledged" && !isAck) return false;
      if (inspectorFilter === "pending" && isAck) return false;
      if (inspectorSearch.trim()) {
        const q = inspectorSearch.toLowerCase();
        if (!u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [inspectorTargetUsers, inspectorFilter, inspectorSearch, inspectorAckMap]);

  return (
    <div className="space-y-6">
      {/* Top Header Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Megaphone className="size-5" />
            </span>
            Announcements &amp; Notices
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Publish official announcements with required acknowledgement tracking for creators and editors.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border border-border bg-card p-1 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition",
                viewMode === "table" ? "bg-primary text-primary-foreground font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutList className="size-3.5" />
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode("feed")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition",
                viewMode === "feed" ? "bg-primary text-primary-foreground font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Grid className="size-3.5" />
              Cards
            </button>
          </div>

          <Button
            onClick={() => setCreateModalOpen(true)}
            className="gap-2 shadow-soft font-semibold"
          >
            <Plus className="size-4" />
            Create announcement
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Announcements</p>
          <p className="mt-2 text-2xl font-bold text-foreground font-mono">{totalAnnouncements}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active</p>
            <span className="flex size-2 rounded-full bg-success animate-pulse" />
          </div>
          <p className="mt-2 text-2xl font-bold text-primary font-mono">{activeAnnouncements}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Archived</p>
          <p className="mt-2 text-2xl font-bold text-muted-foreground font-mono">{archivedAnnouncements}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Target Roles</p>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            Creators, Editors{isAdmin ? ", Managers" : ""}
          </p>
        </div>
      </div>

      {/* Announcements Table & Filters */}
      <div className="rounded-xl border border-border bg-card shadow-soft overflow-hidden">
        {/* Table filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 p-4">
          <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
            <Search className="size-4 text-muted-foreground shrink-0" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search announcements by title or content..."
              className="h-8 text-xs bg-background"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Status:</span>
            <div className="flex items-center rounded-lg border border-border bg-background p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition",
                  statusFilter === "all" ? "bg-primary text-primary-foreground font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("active")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition",
                  statusFilter === "active" ? "bg-primary text-primary-foreground font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("archived")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition",
                  statusFilter === "archived" ? "bg-primary text-primary-foreground font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Archived
              </button>
            </div>
          </div>
        </div>

        {viewMode === "feed" ? (
          /* Cards / Feed View */
          <div className="p-6 space-y-6">
            {filteredAnnouncements.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No announcements found matching criteria.
              </div>
            ) : (
              filteredAnnouncements.map((ann) => (
                <div key={ann.id} className="relative">
                  <AnnouncementCardView
                    announcement={ann}
                    userId={profile.id}
                    onImageClick={(url) => setImagePreview(url)}
                    showAcknowledgementBanner={false}
                  />
                  {/* Action buttons overlay for admin */}
                  <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-card/90 backdrop-blur border border-border p-1 rounded-lg shadow-2xs">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setInspectorAnnouncement(ann);
                        setInspectorFilter("all");
                        setInspectorSearch("");
                      }}
                      className="h-7 text-xs gap-1.5"
                    >
                      <Users className="size-3.5" />
                      Log &amp; Users
                    </Button>
                    {ann.status === "active" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleArchive(ann.id)}
                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                        title="Archive announcement"
                      >
                        <Archive className="size-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleUnarchive(ann.id)}
                        className="h-7 text-xs text-muted-foreground hover:text-primary"
                        title="Restore / Unarchive announcement"
                      >
                        <RotateCcw className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(ann.id, ann.title)}
                      className="h-7 text-xs text-muted-foreground hover:text-destructive"
                      title="Delete announcement"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* Table View */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-muted-foreground font-semibold">
                  <th className="px-4 py-3">Announcement</th>
                  <th className="px-4 py-3">Target Audience</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Acknowledgements</th>
                  <th className="px-4 py-3">Author &amp; Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredAnnouncements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                      No announcements found matching criteria.
                    </td>
                  </tr>
                ) : (
                  filteredAnnouncements.map((ann) => {
                    const targetUsers = getTargetUsersForAnnouncement(ann);
                    const ackCount = ann.acknowledgements?.length ?? 0;
                    const totalTarget = targetUsers.length;
                    const ackPercent = totalTarget > 0 ? Math.min(100, Math.round((ackCount / totalTarget) * 100)) : 0;
                    const formattedDate = new Date(ann.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric"
                    });

                    return (
                      <tr key={ann.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3.5 max-w-xs">
                          <div className="space-y-1">
                            <p className="font-semibold text-foreground text-sm line-clamp-1">{ann.title}</p>
                            <p className="text-muted-foreground text-xs line-clamp-1">{ann.content}</p>
                            <div className="flex items-center gap-2 pt-0.5">
                              {ann.images?.length ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                                  <ImageIcon className="size-3 text-primary" /> {ann.images.length} images
                                </span>
                              ) : null}
                              {ann.attachments?.length ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                                  <Paperclip className="size-3 text-primary" /> {ann.attachments.length} files
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {ann.target_type === "all" ? (
                              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                                All Team
                              </span>
                            ) : ann.target_type === "roles" ? (
                              ann.target_roles.map((r) => (
                                <span
                                  key={r}
                                  className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium"
                                >
                                  {r === "content_creator" ? "Creators" : r === "editor" ? "Editors" : "Managers"}
                                </span>
                              ))
                            ) : (
                              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                                {ann.target_user_ids.length} specific users
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3.5">
                          <span
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                              ann.status === "active" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                            )}
                            title={
                              ann.status === "active"
                                ? "Active: Targeted users are prompted to acknowledge"
                                : "Archived: Concluded, users will no longer be prompted"
                            }
                          >
                            {ann.status}
                          </span>
                        </td>

                        <td className="px-4 py-3.5 min-w-[160px]">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground font-mono">
                                {ackCount} / {totalTarget}
                              </span>
                              <span
                                className={cn(
                                  "font-mono font-semibold text-[11px]",
                                  ackPercent === 100 ? "text-success" : "text-muted-foreground"
                                )}
                              >
                                {ackPercent}%
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  ackPercent === 100 ? "bg-success" : "bg-primary"
                                )}
                                style={{ width: `${ackPercent}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3.5">
                          <p className="font-medium text-foreground">{ann.author_name}</p>
                          <p className="text-[11px] text-muted-foreground">{formattedDate}</p>
                        </td>

                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPreviewAnnouncement(ann)}
                              className="h-7 text-xs text-muted-foreground hover:text-foreground"
                              title="Preview announcement layout"
                            >
                              <Eye className="size-3.5" />
                              <span className="hidden xl:inline ml-1">View</span>
                            </Button>

                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setInspectorAnnouncement(ann);
                                setInspectorFilter("all");
                                setInspectorSearch("");
                              }}
                              className="h-7 text-xs gap-1.5"
                            >
                              <Users className="size-3.5" />
                              Log &amp; Users
                            </Button>

                            {ann.status === "active" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleArchive(ann.id)}
                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                title="Archive announcement"
                              >
                                <Archive className="size-3.5" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleUnarchive(ann.id)}
                                className="h-7 text-xs text-muted-foreground hover:text-primary"
                                title="Restore / Unarchive announcement"
                              >
                                <RotateCcw className="size-3.5" />
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(ann.id, ann.title)}
                              className="h-7 text-xs text-muted-foreground hover:text-destructive"
                              title="Delete announcement"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Announcement Modal */}
      {createModalOpen ? (
        <Modal
          open
          labelledBy="create-announcement-title"
          onClose={() => setCreateModalOpen(false)}
          className="p-0 sm:p-6"
        >
          <div className="mx-auto flex flex-col w-full bg-card rounded-xl border border-border shadow-float max-w-2xl max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-5 shrink-0">
              <div>
                <h2 id="create-announcement-title" className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Megaphone className="size-5 text-primary" />
                  New Announcement
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Send an official announcement to team members with required acknowledgment.
                </p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setCreateModalOpen(false)}>
                <X className="size-5" />
              </Button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateAnnouncement} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Title *</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Mandatory Guidelines Update for Meta Ad Submissions"
                  required
                />
              </div>

              {/* Target Audience */}
              <div className="space-y-2 rounded-lg border border-border p-3.5 bg-muted/20">
                <label className="block text-xs font-semibold text-foreground">Target Audience *</label>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="targetType"
                      checked={targetType === "roles"}
                      onChange={() => setTargetType("roles")}
                      className="text-primary"
                    />
                    <span>By Roles</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="targetType"
                      checked={targetType === "all"}
                      onChange={() => setTargetType("all")}
                      className="text-primary"
                    />
                    <span>All Team Members</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="targetType"
                      checked={targetType === "users"}
                      onChange={() => setTargetType("users")}
                      className="text-primary"
                    />
                    <span>Specific Individuals</span>
                  </label>
                </div>

                {targetType === "roles" ? (
                  <div className="flex flex-wrap gap-4 pt-2 border-t border-border mt-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={targetRoles.includes("content_creator")}
                        onChange={(e) => {
                          if (e.target.checked) setTargetRoles((prev) => [...prev, "content_creator"]);
                          else setTargetRoles((prev) => prev.filter((r) => r !== "content_creator"));
                        }}
                        className="rounded text-primary"
                      />
                      <span>Content Creators</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={targetRoles.includes("editor")}
                        onChange={(e) => {
                          if (e.target.checked) setTargetRoles((prev) => [...prev, "editor"]);
                          else setTargetRoles((prev) => prev.filter((r) => r !== "editor"));
                        }}
                        className="rounded text-primary"
                      />
                      <span>Video Editors</span>
                    </label>
                    {isAdmin ? (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={targetRoles.includes("manager")}
                          onChange={(e) => {
                            if (e.target.checked) setTargetRoles((prev) => [...prev, "manager"]);
                            else setTargetRoles((prev) => prev.filter((r) => r !== "manager"));
                          }}
                          className="rounded text-primary"
                        />
                        <span>Managers</span>
                      </label>
                    ) : null}
                  </div>
                ) : null}

                {targetType === "users" ? (
                  <div className="pt-2 border-t border-border mt-2 max-h-36 overflow-y-auto space-y-1">
                    {allProfiles
                      .filter((p) => p.active && p.role !== "admin")
                      .map((p) => (
                        <label key={p.id} className="flex items-center gap-2 p-1 rounded hover:bg-muted/40 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(p.id)}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedUserIds((prev) => [...prev, p.id]);
                              else setSelectedUserIds((prev) => prev.filter((id) => id !== p.id));
                            }}
                            className="rounded text-primary"
                          />
                          <span className="font-medium text-foreground">{p.name}</span>
                          <span className="text-muted-foreground text-[10px]">({p.role})</span>
                        </label>
                      ))}
                  </div>
                ) : null}
              </div>

              {/* Message Content */}
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Message Content *</label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write the full announcement details here..."
                  rows={6}
                  required
                />
              </div>

              {/* Attached Images */}
              <div className="space-y-2 rounded-lg border border-border p-3.5 bg-muted/20">
                <label className="block text-xs font-semibold text-foreground">Attach Images (Appears centred at top)</label>
                <div className="flex gap-2">
                  <Input
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                    placeholder="Paste image URL..."
                    className="flex-1 text-xs"
                  />
                  <Button type="button" size="sm" variant="secondary" onClick={handleAddImageUrl}>
                    Add URL
                  </Button>
                </div>
                <div className="pt-1">
                  <label className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer">
                    <ImageIcon className="size-3.5" /> Upload image files from device
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageFileChange}
                      className="hidden"
                    />
                  </label>
                </div>

                {images.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {images.map((img, i) => (
                      <div key={i} className="relative size-16 rounded-md border border-border overflow-hidden group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img} alt="" className="size-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute inset-0 bg-black/60 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Upload Attachments of ANY file type (Music, Video, Image, PDF, etc. up to 30 MB) */}
              <div className="space-y-3 rounded-lg border border-border p-3.5 bg-muted/20">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-foreground">
                    Upload Attachments (Any File Type up to 30 MB)
                  </label>
                  <span className="text-[10px] text-muted-foreground">Music, Video, PDF, Docs, Images</span>
                </div>

                {/* Direct file upload button */}
                <div className="rounded-xl border border-dashed border-border bg-card p-4 text-center hover:border-primary/50 transition-colors">
                  <label className="flex flex-col items-center justify-center cursor-pointer">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-2">
                      {uploadingAttachment ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : (
                        <UploadCloud className="size-5" />
                      )}
                    </div>
                    <p className="text-xs font-semibold text-foreground">
                      {uploadingAttachment ? "Uploading file..." : "Click or browse to upload attachments"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Accepts music (.mp3, .wav), video (.mp4, .mov), PDF, images, or archives up to 30 MB each.
                    </p>
                    <input
                      type="file"
                      multiple
                      onChange={handleAttachmentFileUpload}
                      disabled={uploadingAttachment}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Optional external URL/link input */}
                <div className="pt-2 border-t border-border">
                  <p className="text-[11px] text-muted-foreground mb-1.5">Or add external link / Google Drive URL:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={attachmentName}
                      onChange={(e) => setAttachmentName(e.target.value)}
                      placeholder="Title (e.g. Reference Script)"
                      className="text-xs"
                    />
                    <Input
                      value={attachmentUrl}
                      onChange={(e) => setAttachmentUrl(e.target.value)}
                      placeholder="URL (e.g. drive.google.com/...)"
                      className="text-xs"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleAddAttachment}
                    className="mt-2 text-xs gap-1"
                  >
                    <Paperclip className="size-3" /> Add Link
                  </Button>
                </div>

                {/* Uploaded attachments list */}
                {attachments.length > 0 ? (
                  <div className="space-y-1.5 pt-2">
                    <p className="text-xs font-semibold text-foreground">Attached Files ({attachments.length}):</p>
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between rounded-lg bg-card p-2 border border-border shadow-2xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                            {getAttachmentIcon(att.name, att.type)}
                          </div>
                          <div className="min-w-0 truncate">
                            <span className="font-semibold text-foreground text-xs truncate block">{att.name}</span>
                            {att.size ? (
                              <span className="text-[10px] text-muted-foreground">{formatFileSize(att.size)}</span>
                            ) : null}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                          className="text-muted-foreground hover:text-destructive p-1 rounded"
                          title="Remove attachment"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Submit Button */}
              <div className="pt-3 border-t border-border flex justify-end gap-2 shrink-0">
                <Button type="button" variant="ghost" onClick={() => setCreateModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending || uploadingAttachment} className="gap-2 font-semibold">
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
                  Publish Announcement
                </Button>
              </div>
            </form>
          </div>
        </Modal>
      ) : null}

      {/* Preview Modal: Shows announcement with exact requested hierarchy */}
      {previewAnnouncement ? (
        <Modal
          open
          labelledBy="preview-announcement-title"
          onClose={() => setPreviewAnnouncement(null)}
          className="p-0 sm:p-6"
        >
          <div className="mx-auto flex flex-col w-full bg-card rounded-2xl border border-border shadow-float max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-border p-4 shrink-0 bg-muted/30">
              <div className="flex items-center gap-2">
                <Eye className="size-4 text-primary" />
                <span className="text-sm font-bold text-foreground">Announcement Preview</span>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setPreviewAnnouncement(null)}>
                <X className="size-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 sm:p-8">
              <AnnouncementCardView
                announcement={previewAnnouncement}
                userId={profile.id}
                onImageClick={(url) => setImagePreview(url)}
                showAcknowledgementBanner={false}
              />
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Inspector Modal: Who acknowledged vs who is pending */}
      {inspectorAnnouncement ? (
        <Modal
          open
          labelledBy="inspector-title"
          onClose={() => setInspectorAnnouncement(null)}
          className="p-0 sm:p-6"
        >
          <div className="mx-auto flex flex-col w-full bg-card rounded-xl border border-border shadow-float max-w-3xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-border p-5 shrink-0">
              <div>
                <h2 id="inspector-title" className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Users className="size-5 text-primary" />
                  Acknowledgement Tracking Log
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">
                  {inspectorAnnouncement.title}
                </p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setInspectorAnnouncement(null)}>
                <X className="size-5" />
              </Button>
            </div>

            {/* Filter and stats row */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 p-4 text-xs shrink-0">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setInspectorFilter("all")}
                  className={cn(
                    "px-3 py-1 rounded-lg font-medium transition",
                    inspectorFilter === "all" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  All ({inspectorTargetUsers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorFilter("acknowledged")}
                  className={cn(
                    "px-3 py-1 rounded-lg font-medium transition",
                    inspectorFilter === "acknowledged" ? "bg-success text-success-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  Acknowledged ({inspectorAnnouncement.acknowledgements?.length ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorFilter("pending")}
                  className={cn(
                    "px-3 py-1 rounded-lg font-medium transition",
                    inspectorFilter === "pending" ? "bg-warning text-warning-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  Pending (
                    {Math.max(0, inspectorTargetUsers.length - (inspectorAnnouncement.acknowledgements?.length ?? 0))}
                  )
                </button>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Search className="size-3.5 text-muted-foreground shrink-0" />
                <Input
                  value={inspectorSearch}
                  onChange={(e) => setInspectorSearch(e.target.value)}
                  placeholder="Filter person..."
                  className="h-7 text-xs w-full sm:w-44"
                />
              </div>
            </div>

            {/* Users list */}
            <div className="flex-1 overflow-y-auto p-4 divide-y divide-border">
              {filteredInspectorUsers.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No people match the selected filter.
                </div>
              ) : (
                filteredInspectorUsers.map((user) => {
                  const ack = inspectorAckMap.get(user.id);
                  const ackFormatted = ack
                    ? new Date(ack.acknowledged_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })
                    : null;

                  return (
                    <div key={user.id} className="flex items-center justify-between py-2.5 px-2 hover:bg-muted/30 rounded">
                      <div className="flex items-center gap-3">
                        <Avatar name={user.name} src={user.avatar_url} className="size-8" />
                        <div>
                          <p className="font-semibold text-xs text-foreground">{user.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {user.email} · <span className="capitalize">{user.role.replace("_", " ")}</span>
                          </p>
                        </div>
                      </div>

                      <div>
                        {ack ? (
                          <div className="text-right">
                            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                              <CheckCircle2 className="size-3" />
                              Acknowledged
                            </span>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{ackFormatted}</p>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-[11px] font-semibold text-warning">
                            <Clock className="size-3" />
                            Pending acknowledgement
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Modal>
      ) : null}

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
