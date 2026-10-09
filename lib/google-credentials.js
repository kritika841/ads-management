/**
 * Tolerant parser for the Google service-account credentials stored in
 * GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON. Shared by the Next.js app (lib/drive.ts) and the
 * raw-clip tagging worker (scripts/ingest-ads-clip-segments.cjs).
 *
 * Why this exists: the production .env stores the key as
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON="{\"type\":\"service_account\",...,\"private_key\":\"-----BEGIN...\n...\"}"
 * dotenv only expands `\n` inside double quotes — it does NOT unescape `\"` — so the process
 * receives `{\"type\"...` (and real newlines inside the private key). A plain JSON.parse fails at
 * position 1, which silently disabled Drive access and made every raw-clip tagging run exit 1.
 *
 * Accepted inputs (first one that yields an object wins):
 *  - plain JSON, optionally wrapped in single/double quotes
 *  - JSON with backslash-escaped quotes (`{\"type\":...}`)
 *  - JSON whose string values contain raw newlines (dotenv-expanded `\n`)
 *  - JSON encoded as a JSON string (double-encoded)
 *  - base64-encoded JSON
 *  - a path to a key file that exists on this machine
 */
import { existsSync, readFileSync } from "node:fs";

function stripWrappingQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && last === first) return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function escapeRawNewlines(value) {
  return value.replace(/\r?\n/g, "\\n");
}

function tryParseObject(text) {
  try {
    let parsed = JSON.parse(text);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeCredentials(credentials) {
  if (typeof credentials.private_key === "string") {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }
  return credentials;
}

function parseJsonText(text) {
  const candidates = [text, text.replace(/\\"/g, '"')];
  for (const candidate of candidates) {
    const parsed = tryParseObject(candidate) ?? tryParseObject(escapeRawNewlines(candidate));
    if (parsed) return normalizeCredentials(parsed);
  }
  return null;
}

/**
 * @param {string | null | undefined} raw
 * @returns {Record<string, unknown> | null} the credentials object, or null when `raw` is empty
 * @throws {Error} when a value is present but can't be turned into credentials
 */
export function parseServiceAccountCredentials(raw) {
  if (!raw || !String(raw).trim()) return null;
  const source = stripWrappingQuotes(String(raw));

  if (source.startsWith("{") || source.startsWith('"')) {
    const parsed = parseJsonText(source);
    if (parsed) return parsed;
    throw new Error(
      "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not valid JSON (also tried unescaping quotes and newlines). " +
        "Store the key on one line, e.g. GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON='{\"type\":\"service_account\",...}', or base64-encode it."
    );
  }

  if (existsSync(source)) {
    const parsed = parseJsonText(readFileSync(source, "utf8"));
    if (parsed) return parsed;
    throw new Error(`Service-account key file ${source} does not contain valid JSON.`);
  }

  if (/^[A-Za-z0-9+/=_-]+$/.test(source) && source.length > 100) {
    const parsed = parseJsonText(Buffer.from(source, "base64").toString("utf8"));
    if (parsed) return parsed;
  }

  throw new Error("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is neither JSON, base64-encoded JSON nor an existing key file path.");
}
