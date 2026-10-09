import { describe, expect, it } from "vitest";
import { emptyDashboardFilters, parseFilterList, readDashboardFilters, writeDashboardFilters } from "@/lib/dashboard-filter-state";

describe("dashboard URL filter state", () => {
  it("reads every supported filter and prefers a shared view", () => {
    const state = readDashboardFilters("?q=launch&stage=editing&editor=e1&creator=c1&campaign=ca1&product=p1&platform=Meta+Ads&tag=hook&download=downloaded&deadline=soon&sort=waiting&view=table", "grid");
    expect(state).toEqual({ q: "launch", stage: ["editing"], editor: ["e1"], creator: ["c1"], campaign: ["ca1"], product: ["p1"], platform: ["Meta Ads"], tag: ["hook"], download: ["downloaded"], deadline: ["soon"], sort: "waiting", dateFrom: "", dateTo: "", view: "table" });
  });

  it("reads and serializes date range filters", () => {
    const state = readDashboardFilters("?dateFrom=2026-10-01&dateTo=2026-10-07");
    expect(state.dateFrom).toBe("2026-10-01");
    expect(state.dateTo).toBe("2026-10-07");

    const url = writeDashboardFilters(new URL("https://adflow.test/library"), { ...emptyDashboardFilters, dateFrom: "2026-10-01", dateTo: "2026-10-07" });
    expect(url.searchParams.get("dateFrom")).toBe("2026-10-01");
    expect(url.searchParams.get("dateTo")).toBe("2026-10-07");
  });

  it("serializes multiple selected tags as a comma-separated value", () => {
    const state = readDashboardFilters("?tag=hook,loop,retarget", "grid");
    expect(state.tag).toEqual(["hook", "loop", "retarget"]);

    const url = writeDashboardFilters(new URL("https://adflow.test/library"), { ...emptyDashboardFilters, tag: ["hook", "loop", "retarget"] });
    expect(url.searchParams.get("tag")).toBe("hook,loop,retarget");
  });

  it("supports multiple values for every list filter, like tags", () => {
    const state = readDashboardFilters("?stage=editing,approved&editor=e1,e2&creator=c1,c2&campaign=a,b&product=p1,p2&platform=Meta+Ads,Youtube+Ads&deadline=overdue,today");
    expect(state.stage).toEqual(["editing", "approved"]);
    expect(state.editor).toEqual(["e1", "e2"]);
    expect(state.creator).toEqual(["c1", "c2"]);
    expect(state.campaign).toEqual(["a", "b"]);
    expect(state.product).toEqual(["p1", "p2"]);
    expect(state.platform).toEqual(["Meta Ads", "Youtube Ads"]);
    expect(state.deadline).toEqual(["overdue", "today"]);

    const url = writeDashboardFilters(new URL("https://adflow.test/library"), state);
    expect(url.searchParams.get("stage")).toBe("editing,approved");
    expect(url.searchParams.get("platform")).toBe("Meta Ads,Youtube Ads");
    expect(readDashboardFilters(url.search)).toEqual(state);
  });

  it("treats legacy 'all' values as no filter and de-duplicates", () => {
    expect(parseFilterList("all")).toEqual([]);
    expect(parseFilterList("a,a,,b")).toEqual(["a", "b"]);
    expect(readDashboardFilters("?stage=all&editor=").editor).toEqual([]);
  });

  it("serializes the download-state filter and rejects unknown values", () => {
    const url = writeDashboardFilters(new URL("https://adflow.test/library"), { ...emptyDashboardFilters, download: ["not_downloaded"] });
    expect(url.searchParams.get("download")).toBe("not_downloaded");
    expect(readDashboardFilters("?download=unexpected").download).toEqual([]);
  });

  it("omits defaults and preserves unrelated URL parameters", () => {
    const url = writeDashboardFilters(new URL("https://adflow.test/library?queue=all&stage=old"), emptyDashboardFilters);
    expect(url.searchParams.get("queue")).toBe("all");
    expect(url.searchParams.has("stage")).toBe(false);
    expect(url.searchParams.has("view")).toBe(false);
  });
});
