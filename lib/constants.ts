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
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  pending_review: "bg-amber-100 text-amber-800 ring-amber-200",
  changes_requested: "bg-orange-100 text-orange-800 ring-orange-200",
  approved: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  rejected: "bg-rose-100 text-rose-800 ring-rose-200",
  published: "bg-sky-100 text-sky-800 ring-sky-200"
};

export const reviewerRoles: UserRole[] = ["admin", "manager"];
