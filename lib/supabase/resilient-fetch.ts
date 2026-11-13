// Retries idempotent Supabase requests on transient failures (network reset, gateway 502/503/504,
// or mid-stream HTTP/2 / socket closure when reading large JSON payloads).
// Industry-standard rules applied:
//  - only GET/HEAD are retried (never writes / RPCs → no duplicate side effects)
//  - capped exponential backoff with jitter
//  - statement timeouts (HTTP 500) are NOT retried: retrying an overloaded DB makes it worse
const RETRYABLE_STATUS = new Set([502, 503, 504, 520, 522, 524]);
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const resilientFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const isRestQuery = urlStr.includes("/rest/v1/");

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(input, init);
      if (!idempotent || RETRYABLE_STATUS.has(response.status)) {
        if (!idempotent || attempt >= MAX_RETRIES || !RETRYABLE_STATUS.has(response.status)) {
          return response;
        }
      } else if (method === "GET" && isRestQuery && typeof response.arrayBuffer === "function") {
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
