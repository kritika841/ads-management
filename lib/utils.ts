import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function absoluteUrl(path = "") {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function formatDurationHours(hours: number | null) {
  if (hours === null || Number.isNaN(hours)) {
    return "n/a";
  }

  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }

  return `${(hours / 24).toFixed(1)}d`;
}

const appTimeZone = "Asia/Kolkata";
const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: appTimeZone
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: appTimeZone
});
const dateOnlyFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC"
});

export function formatDate(value: string | number | Date) {
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string | number | Date) {
  return dateTimeFormatter.format(new Date(value));
}

export function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return dateOnlyFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}

export function dateOnlyDaysFromToday(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: appTimeZone
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(todayParts.find((item) => item.type === type)?.value);
  const todayUtc = Date.UTC(part("year"), part("month") - 1, part("day"));
  return Math.round((Date.UTC(year, month - 1, day) - todayUtc) / 86_400_000);
}
