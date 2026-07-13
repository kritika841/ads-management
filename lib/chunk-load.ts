const CHUNK_FAILURE_PATTERNS = [
  /chunkloaderror/i,
  /loading chunk .* failed/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i
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

export function isNextChunkUrl(value: unknown) {
  return typeof value === "string" && value.includes("/_next/static/chunks/");
}
