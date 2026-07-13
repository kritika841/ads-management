export type DashboardView = "grid" | "table";

export type DashboardFilterState = {
  q: string;
  stage: string;
  editor: string;
  creator: string;
  campaign: string;
  product: string;
  platform: string;
  tag: string;
  deadline: string;
  sort: string;
  view: DashboardView;
};

export const emptyDashboardFilters: DashboardFilterState = {
  q: "",
  stage: "all",
  editor: "all",
  creator: "all",
  campaign: "all",
  product: "all",
  platform: "all",
  tag: "all",
  deadline: "all",
  sort: "all",
  view: "grid"
};

export function readDashboardFilters(search: string, savedView?: string | null): DashboardFilterState {
  const params = new URLSearchParams(search);
  const requestedView = params.get("view") ?? savedView;
  return {
    q: params.get("q") ?? "",
    stage: params.get("stage") ?? "all",
    editor: params.get("editor") ?? "all",
    creator: params.get("creator") ?? "all",
    campaign: params.get("campaign") ?? "all",
    product: params.get("product") ?? "all",
    platform: params.get("platform") ?? "all",
    tag: params.get("tag") ?? "all",
    deadline: params.get("deadline") ?? "all",
    sort: params.get("sort") ?? "all",
    view: requestedView === "table" ? "table" : "grid"
  };
}

export function writeDashboardFilters(url: URL, state: DashboardFilterState) {
  for (const [key, value] of Object.entries(state)) {
    const isDefault = value === "" || value === "all" || (key === "view" && value === "grid");
    if (isDefault) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return url;
}
