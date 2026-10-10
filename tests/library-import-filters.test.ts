import { describe, it, expect } from "vitest";

interface FilterableItem {
  id: string;
  name: string;
  created_at: string;
  final_approved_at: string | null;
}

function filterAndSortCreatives(
  items: FilterableItem[],
  dateFilter: string,
  dateFrom: string,
  dateTo: string,
  sortBy: string,
  now = new Date("2026-10-09T12:00:00Z")
) {
  let list = items.filter((ad) => {
    if (dateFilter === "all") return true;

    const adDate = new Date(ad.created_at);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (dateFilter === "today") {
      return adDate >= startOfToday;
    }
    if (dateFilter === "last_7_days") {
      const past7 = new Date(now.getTime() - 7 * 86400000);
      return adDate >= past7;
    }
    if (dateFilter === "last_30_days") {
      const past30 = new Date(now.getTime() - 30 * 86400000);
      return adDate >= past30;
    }
    if (dateFilter === "this_month") {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return adDate >= startOfMonth;
    }
    if (dateFilter === "custom") {
      if (dateFrom && adDate < new Date(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && adDate > new Date(`${dateTo}T23:59:59`)) return false;
      return true;
    }
    return true;
  });

  list.sort((a, b) => {
    if (sortBy === "created_desc") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortBy === "created_asc") {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (sortBy === "approved_desc") {
      const timeA = a.final_approved_at ? new Date(a.final_approved_at).getTime() : 0;
      const timeB = b.final_approved_at ? new Date(b.final_approved_at).getTime() : 0;
      return timeB - timeA;
    }
    if (sortBy === "name_asc") {
      return a.name.localeCompare(b.name);
    }
    return 0;
  });

  return list;
}

describe("Library Import Modal Filtering & Sorting", () => {
  const items: FilterableItem[] = [
    { id: "1", name: "Zeta Hook", created_at: "2026-10-09T08:00:00Z", final_approved_at: "2026-10-09T09:00:00Z" },
    { id: "2", name: "Alpha Hook", created_at: "2026-10-05T08:00:00Z", final_approved_at: "2026-10-06T08:00:00Z" },
    { id: "3", name: "Beta Hook", created_at: "2026-09-15T08:00:00Z", final_approved_at: "2026-10-08T12:00:00Z" },
    { id: "4", name: "Gamma Hook", created_at: "2026-08-01T08:00:00Z", final_approved_at: null }
  ];

  it("filters by today", () => {
    const res = filterAndSortCreatives(items, "today", "", "", "created_desc");
    expect(res.map((r) => r.id)).toEqual(["1"]);
  });

  it("filters by last 7 days", () => {
    const res = filterAndSortCreatives(items, "last_7_days", "", "", "created_desc");
    expect(res.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("filters by last 30 days", () => {
    const res = filterAndSortCreatives(items, "last_30_days", "", "", "created_desc");
    expect(res.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("filters by custom date range", () => {
    const res = filterAndSortCreatives(items, "custom", "2026-09-01", "2026-10-06", "created_desc");
    expect(res.map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("sorts by name ascending", () => {
    const res = filterAndSortCreatives(items, "all", "", "", "name_asc");
    expect(res.map((r) => r.name)).toEqual(["Alpha Hook", "Beta Hook", "Gamma Hook", "Zeta Hook"]);
  });

  it("sorts by recently approved", () => {
    const res = filterAndSortCreatives(items, "all", "", "", "approved_desc");
    expect(res.map((r) => r.id)).toEqual(["1", "3", "2", "4"]);
  });

  it("sorts by created oldest first", () => {
    const res = filterAndSortCreatives(items, "all", "", "", "created_asc");
    expect(res.map((r) => r.id)).toEqual(["4", "3", "2", "1"]);
  });
});
