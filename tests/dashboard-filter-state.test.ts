import { describe, expect, it } from "vitest";
import { emptyDashboardFilters, readDashboardFilters, writeDashboardFilters } from "@/lib/dashboard-filter-state";

describe("dashboard URL filter state", () => {
  it("reads every supported filter and prefers a shared view", () => {
    const state = readDashboardFilters("?q=launch&stage=editing&editor=e1&creator=c1&campaign=ca1&product=p1&platform=Meta+Ads&tag=hook&deadline=soon&sort=waiting&view=table", "grid");
    expect(state).toEqual({ q: "launch", stage: "editing", editor: "e1", creator: "c1", campaign: "ca1", product: "p1", platform: "Meta Ads", tag: "hook", deadline: "soon", sort: "waiting", view: "table" });
  });

  it("serializes multiple selected tags as a comma-separated value", () => {
    const state = readDashboardFilters("?tag=hook,loop,retarget", "grid");
    expect(state.tag).toBe("hook,loop,retarget");

    const url = writeDashboardFilters(new URL("https://adflow.test/library"), { ...emptyDashboardFilters, tag: "hook,loop,retarget" });
    expect(url.searchParams.get("tag")).toBe("hook,loop,retarget");
  });

  it("omits defaults and preserves unrelated URL parameters", () => {
    const url = writeDashboardFilters(new URL("https://adflow.test/library?queue=all&stage=old"), emptyDashboardFilters);
    expect(url.searchParams.get("queue")).toBe("all");
    expect(url.searchParams.has("stage")).toBe(false);
    expect(url.searchParams.has("view")).toBe(false);
  });
});
