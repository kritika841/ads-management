import type { UserRole } from "@/lib/types";

export type UserSyncState = {
  ads_count: number;
  ads_latest: string | null;
  new_assignments: number;
  comments_count: number;
  comments_latest: string | null;
  reviews_count: number;
  reviews_latest: string | null;
  annotations_count: number;
  annotations_latest: string | null;
  activity_count: number;
  activity_latest: string | null;
  notifications_count: number;
  notifications_latest: string | null;
  notifications_unread: number;
};

const countKeys = [
  "ads_count",
  "new_assignments",
  "comments_count",
  "reviews_count",
  "annotations_count",
  "activity_count",
  "notifications_count",
  "notifications_unread"
] as const satisfies readonly (keyof UserSyncState)[];

const timestampKeys = [
  "ads_latest",
  "comments_latest",
  "reviews_latest",
  "annotations_latest",
  "activity_latest",
  "notifications_latest"
] as const satisfies readonly (keyof UserSyncState)[];

export function parseUserSyncState(value: unknown): UserSyncState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const parsed: Record<string, number | string | null> = {};

  for (const key of countKeys) {
    const count = typeof record[key] === "string" ? Number(record[key]) : record[key];
    if (typeof count !== "number" || !Number.isFinite(count)) return null;
    parsed[key] = count;
  }
  for (const key of timestampKeys) {
    const timestamp = record[key];
    if (timestamp !== null && typeof timestamp !== "string") return null;
    parsed[key] = timestamp;
  }

  return parsed as UserSyncState;
}

export function compareUserSyncStates(previous: UserSyncState | null, current: UserSyncState, role: UserRole) {
  if (!previous) return { changed: false, newAssignmentCount: 0 };
  return {
    changed: JSON.stringify(previous) !== JSON.stringify(current),
    newAssignmentCount: role === "editor" ? Math.max(0, current.new_assignments - previous.new_assignments) : 0
  };
}
