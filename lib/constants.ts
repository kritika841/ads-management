import type { AdStatus, Platform, UserRole } from "@/lib/types";

export const userRoles: UserRole[] = ["admin", "manager", "editor", "content_creator"];

export const adStatuses: AdStatus[] = [
  "draft",
  "pending_review",
  "changes_requested",
  "approved",
  "rejected",
  "published"
];

export const platforms: Platform[] = [
  "Meta Ads",
  "Youtube Ads",
  "Taboola Ads",
  "Social Media"
];

export const statusLabels: Record<AdStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  changes_requested: "Changes Requested",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published"
};

export const statusStyles: Record<AdStatus, string> = {
  draft: "bg-muted text-muted-foreground ring-border",
  pending_review: "bg-warning/15 text-warning ring-warning/30",
  changes_requested: "bg-warning/15 text-warning ring-warning/30",
  approved: "bg-success/15 text-success ring-success/30",
  rejected: "bg-destructive/10 text-destructive ring-destructive/30",
  published: "bg-accent text-accent-foreground ring-primary/25"
};

export const reviewerRoles: UserRole[] = ["admin", "manager"];
