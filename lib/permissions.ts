import type { AdStatus, UserRole } from "@/lib/types";

export function canEditAd(params: {
  role: UserRole;
  userId: string;
  creatorId: string | null;
  editorId: string | null;
  status: AdStatus;
}) {
  if (params.role === "admin" || params.role === "manager") {
    return true;
  }

  return (
    ["content_creator", "editor"].includes(params.role) &&
    ["draft", "changes_requested", "rejected"].includes(params.status) &&
    (params.userId === params.creatorId || params.userId === params.editorId)
  );
}

export function canSubmitAd(params: {
  role: UserRole;
  userId: string;
  creatorId: string | null;
  editorId: string | null;
  status: AdStatus;
}) {
  if (params.role === "admin" || params.role === "manager") {
    return params.status !== "published";
  }

  return (
    ["content_creator", "editor"].includes(params.role) &&
    ["draft", "changes_requested", "rejected"].includes(params.status) &&
    (params.userId === params.creatorId || params.userId === params.editorId)
  );
}

export function canDeleteAd(role: UserRole) {
  return role === "admin" || role === "manager";
}

export function canPublish(role: UserRole, status: AdStatus) {
  return (role === "admin" || role === "manager") && status === "approved";
}
