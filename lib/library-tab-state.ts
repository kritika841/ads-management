export const LIBRARY_QUEUE_COOKIE = "adflow_library_queue";
export const LIBRARY_REVIEW_TAB_COOKIE = "adflow_library_review_tab";

export type LibraryReviewTab = "all" | "new" | "editor" | "creator";

const reviewTabs: readonly LibraryReviewTab[] = ["all", "new", "editor", "creator"];

/** Narrow an untrusted URL/cookie value to a known review sub-tab (or null). */
export function parseLibraryReviewTab(value: string | null | undefined): LibraryReviewTab | null {
  return reviewTabs.includes(value as LibraryReviewTab) ? (value as LibraryReviewTab) : null;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Remember the last opened Creative Library tab in a cookie and localStorage. A cookie
 * lets the server render the correct tab on the very first paint after a refresh,
 * while localStorage provides persistence across page reloads even if cookies are restricted.
 */
export function rememberLibraryTab(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  try {
    window.localStorage.setItem(name, value);
  } catch {
    // Ignore storage quota or security errors
  }
}

export function getSavedLibraryTabLocal(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(name);
  } catch {
    return null;
  }
}
