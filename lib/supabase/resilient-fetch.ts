// Retries idempotent Supabase requests on transient failures (network reset, gateway 502/503/504,
// or mid-stream HTTP/2 / socket closure when reading large JSON payloads).
// Industry-standard rules applied:
//  - only GET/HEAD are retried (never writes / RPCs → no duplicate side effects)
//  - capped exponential backoff with jitter
//  - statement timeouts (HTTP 500) are NOT retried: retrying an overloaded DB makes it worse
const RETRYABLE_STATUS = new Set([502, 503, 504, 520, 522, 524]);
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 250;
const MAX_BUFFERED_REST_BYTES = 8 * 1024 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveInternalUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof window !== "undefined") return input;
  const internalBase = process.env.SUPABASE_INTERNAL_URL?.trim().replace(/\/+$/, "");
  const publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!internalBase || !publicBase || internalBase === publicBase) return input;

  if (typeof input === "string") {
    if (input.startsWith(`${publicBase}/`)) {
      return `${internalBase}${input.slice(publicBase.length)}`;
    }
    return input;
  }
  if (input instanceof URL) {
    const str = input.toString();
    if (str.startsWith(`${publicBase}/`)) {
      return new URL(`${internalBase}${str.slice(publicBase.length)}`);
    }
    return input;
  }
  if (input.url.startsWith(`${publicBase}/`)) {
    const rewritten = `${internalBase}${input.url.slice(publicBase.length)}`;
    return new Request(rewritten, input);
  }
  return input;
}

export const resilientFetch: typeof fetch = async (input, init) => {
  const target = resolveInternalUrl(input);
  const method = (init?.method ?? (target instanceof Request ? target.method : "GET")).toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const urlStr = typeof target === "string" ? target : target instanceof URL ? target.toString() : target.url;
  const isRestQuery = urlStr.includes("/rest/v1/");

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(target, init);
      if (!idempotent || RETRYABLE_STATUS.has(response.status)) {
        if (!idempotent || attempt >= MAX_RETRIES || !RETRYABLE_STATUS.has(response.status)) {
          return response;
        }
      } else if (method === "GET" && isRestQuery && typeof response.arrayBuffer === "function") {
        const declaredLength = Number(response.headers?.get?.("content-length") ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > MAX_BUFFERED_REST_BYTES) {
          return response;
        }
        // Buffer the response body inside the retry loop so mid-stream socket/HTTP2 resets
        // (TypeError: terminated / UND_ERR_SOCKET / NGHTTP2_INTERNAL_ERROR) are caught and retried.
        const body = await response.arrayBuffer();
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } else {
        return response;
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      if (!idempotent || aborted || attempt >= MAX_RETRIES) throw error;
    }
    await sleep(BASE_DELAY_MS * 2 ** attempt + Math.random() * BASE_DELAY_MS);
  }
};
