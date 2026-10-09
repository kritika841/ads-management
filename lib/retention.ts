/**
 * Retention windows that administrators can tune from the dashboard.
 * Kept free of server imports so client components can share the defaults and limits.
 */
export const DEFAULT_DOWNLOAD_RETENTION_DAYS = 3;
export const DEFAULT_RECYCLE_BIN_RETENTION_DAYS = 7;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 365;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Coerce an untrusted value into a whole number of days within the supported range. */
export function normalizeRetentionDays(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return fallback;
  const whole = Math.floor(parsed);
  if (whole < MIN_RETENTION_DAYS || whole > MAX_RETENTION_DAYS) return fallback;
  return whole;
}

export function formatRetentionDays(days: number) {
  return `${days} day${days === 1 ? "" : "s"}`;
}
