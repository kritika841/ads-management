const CHUNK_FAILURE_PATTERNS = [
  /chunkloaderror/i,
  /loading chunk .* failed/i,
  /loading css chunk .* failed/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load resource: .*_next\/static/i,
  /failed to load resource: the server responded with a status of 404.*_next/i,
  /failed to fetch rsc payload/i,
  /unexpected token '<', "<!DOCTYPE "/i,
  /unexpected token '<', "<html>"/i,
  /e\[t\]\.call is not a function/i
];

const STALE_ACTION_PATTERNS = [
  /unrecognizedactionerror/i,
  /server action .* was not found on the server/i,
  /failed to find server action/i,
  /could not find server action/i
];

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  const candidate = value as { message?: unknown; name?: unknown };
  return [candidate.name, candidate.message]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

export function isChunkLoadFailure(value: unknown) {
  const text = errorText(value);
  return CHUNK_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function isStaleApplicationFailure(value: unknown) {
  const text = errorText(value);
  return isChunkLoadFailure(value) || STALE_ACTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isNextChunkUrl(value: unknown) {
  if (typeof value !== "string") return false;
  return (
    value.includes("/_next/static/chunks/") ||
    value.includes("/_next/static/css/") ||
    value.includes("/_next/static/media/")
  );
}
