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
    ["content_creator", "editor", "media_buyer"].includes(params.role) &&
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
    ["content_creator", "editor", "media_buyer"].includes(params.role) &&
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

export function canBulkAddToCampaign(
  role: UserRole,
  settings?: { bulk_add_to_campaign_roles?: string[] } | null
): boolean {
  if (role === "admin") return true;
  if (!settings || !settings.bulk_add_to_campaign_roles) return false;
  return settings.bulk_add_to_campaign_roles.includes(role);
}

export function canViewAdInLibrary(
  ad: { creator_id: string | null; editor_id: string | null; collaborator_ids?: string[] },
  profile: { id: string; role: UserRole },
  settings?: { manager_creative_scope?: "all" | "own" } | null
): boolean {
  if (profile.role === "admin" || profile.role === "media_buyer") return true;
  if (profile.role === "manager") {
    if (settings?.manager_creative_scope === "own") {
      return (
        ad.creator_id === profile.id ||
        ad.editor_id === profile.id ||
        Boolean(ad.collaborator_ids?.includes(profile.id))
      );
    }
    return true;
  }
  if (profile.role === "content_creator") {
    return ad.creator_id === profile.id || Boolean(ad.collaborator_ids?.includes(profile.id));
  }
  if (profile.role === "editor") {
    return ad.editor_id === profile.id || Boolean(ad.collaborator_ids?.includes(profile.id));
  }
  return false;
}

export function filterAdsForProfile<
  T extends { creator_id: string | null; editor_id: string | null; collaborator_ids?: string[] }
>(
  ads: T[],
  profile: { id: string; role: UserRole },
  settings?: { manager_creative_scope?: "all" | "own" } | null
): T[] {
  if (profile.role === "admin" || profile.role === "media_buyer") return ads;
  if (profile.role === "manager" && settings?.manager_creative_scope !== "own") return ads;
  return ads.filter((ad) => canViewAdInLibrary(ad, profile, settings));
}
