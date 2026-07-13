import { describe, expect, it } from "vitest";
import { compareUserSyncStates, parseUserSyncState, type UserSyncState } from "@/lib/sync-state";

const baseline: UserSyncState = {
  ads_count: 2,
  ads_latest: "2026-07-10T10:00:00Z",
  new_assignments: 0,
  comments_count: 1,
  comments_latest: "2026-07-10T09:00:00Z",
  reviews_count: 1,
  reviews_latest: "2026-07-10T09:30:00Z",
  annotations_count: 0,
  annotations_latest: null,
  activity_count: 3,
  activity_latest: "2026-07-10T10:00:00Z",
  notifications_count: 1,
  notifications_latest: "2026-07-10T10:00:00Z",
  notifications_unread: 1
};

describe("user sync state", () => {
  it("accepts Postgres numeric counts and nullable timestamps", () => {
    expect(parseUserSyncState({ ...baseline, ads_count: "2" })).toEqual(baseline);
    expect(parseUserSyncState({ ...baseline, comments_latest: 4 })).toBeNull();
    expect(parseUserSyncState(null)).toBeNull();
  });

  it("does not refresh for the initial baseline or an unchanged check", () => {
    expect(compareUserSyncStates(null, baseline, "editor")).toEqual({ changed: false, newAssignmentCount: 0 });
    expect(compareUserSyncStates(baseline, { ...baseline }, "editor")).toEqual({ changed: false, newAssignmentCount: 0 });
  });

  it("detects assignment increases only for editors", () => {
    const changed = { ...baseline, ads_count: 3, new_assignments: 1, ads_latest: "2026-07-10T10:05:00Z" };
    expect(compareUserSyncStates(baseline, changed, "editor")).toEqual({ changed: true, newAssignmentCount: 1 });
    expect(compareUserSyncStates(baseline, changed, "manager")).toEqual({ changed: true, newAssignmentCount: 0 });
  });
});
