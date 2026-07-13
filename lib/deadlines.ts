import type { AdStatus } from "@/lib/types";

export const deadlineActiveStatuses: AdStatus[] = [
  "draft",
  "pending_review",
  "changes_requested",
  "rejected"
];

export function isDeadlineActiveStatus(status: AdStatus) {
  return deadlineActiveStatuses.includes(status);
}

export function indiaDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function indiaDateString(now = new Date(), addDays = 0) {
  const { year, month, day } = indiaDateParts(now);
  const shifted = new Date(Date.UTC(year, month - 1, day + addDays));
  return shifted.toISOString().slice(0, 10);
}

export function indiaDayStartIso(now = new Date()) {
  const { year, month, day } = indiaDateParts(now);
  return new Date(Date.UTC(year, month - 1, day, -5, -30)).toISOString();
}
