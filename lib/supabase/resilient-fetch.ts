// Retries idempotent Supabase requests on transient failures (network reset, gateway 502/503/504).
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

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(input, init);
      if (!idempotent || attempt >= MAX_RETRIES || !RETRYABLE_STATUS.has(response.status)) return response;
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      if (!idempotent || aborted || attempt >= MAX_RETRIES) throw error;
    }
    await sleep(BASE_DELAY_MS * 2 ** attempt + Math.random() * BASE_DELAY_MS);
  }
};
