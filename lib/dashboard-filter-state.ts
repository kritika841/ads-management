export type DashboardView = "grid" | "table";

/** Filters that accept several selected values (serialised as a comma-separated URL param). */
export const multiFilterKeys = ["stage", "editor", "creator", "campaign", "product", "platform", "tag", "download", "deadline"] as const;
export type MultiFilterKey = (typeof multiFilterKeys)[number];

export type DashboardFilterState = {
  q: string;
  stage: string[];
  editor: string[];
  creator: string[];
  campaign: string[];
  product: string[];
  platform: string[];
  tag: string[];
  download: string[];
  deadline: string[];
  sort: string;
  dateFrom: string;
  dateTo: string;
  view: DashboardView;
};

export const emptyDashboardFilters: DashboardFilterState = {
  q: "",
  stage: [],
  editor: [],
  creator: [],
  campaign: [],
  product: [],
  platform: [],
  tag: [],
  download: [],
  deadline: [],
  sort: "all",
  dateFrom: "",
  dateTo: "",
  view: "grid"
};

const downloadValues = ["downloaded", "not_downloaded"];

/**
 * Parses a comma-separated URL value into a de-duplicated list. Legacy
 * single-value links (`?stage=editing`) still work and the old "all" sentinel
 * means "no filter".
 */
export function parseFilterList(value: string | null | undefined): string[] {
  if (!value) return [];
  const items = value.split(",").map((item) => item.trim()).filter((item) => item && item !== "all");
  return Array.from(new Set(items));
}

export function readDashboardFilters(search: string | URLSearchParams, savedView?: string | null): DashboardFilterState {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const requestedView = params.get("view") ?? savedView;
  return {
    q: params.get("q") ?? "",
    stage: parseFilterList(params.get("stage")),
    editor: parseFilterList(params.get("editor")),
    creator: parseFilterList(params.get("creator")),
    campaign: parseFilterList(params.get("campaign")),
    product: parseFilterList(params.get("product")),
    platform: parseFilterList(params.get("platform")),
    tag: parseFilterList(params.get("tag")),
    download: parseFilterList(params.get("download")).filter((item) => downloadValues.includes(item)),
    deadline: parseFilterList(params.get("deadline")),
    sort: params.get("sort") ?? "all",
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
    view: requestedView === "table" ? "table" : "grid"
  };
}

export function writeDashboardFilters(url: URL, state: DashboardFilterState) {
  for (const [key, value] of Object.entries(state)) {
    const serialised = Array.isArray(value) ? value.join(",") : (value ?? "");
    const isDefault = serialised === "" || serialised === "all" || (key === "view" && serialised === "grid");
    if (isDefault) url.searchParams.delete(key);
    else url.searchParams.set(key, serialised);
  }
  return url;
}

export const DASHBOARD_FILTERS_STORAGE_KEY = "adflow_library_filters_v2";

export function loadSavedDashboardFilters(): Partial<DashboardFilterState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DASHBOARD_FILTERS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveDashboardFilters(state: DashboardFilterState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DASHBOARD_FILTERS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearSavedDashboardFilters() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DASHBOARD_FILTERS_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
