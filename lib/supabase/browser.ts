"use client";

import { createBrowserClient } from "@supabase/ssr";

function createLocalhostProxyFetch(supabaseUrl: string): typeof fetch | undefined {
  if (typeof window === "undefined") return undefined;

  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (!isLocalhost) return undefined;

  let supabaseOrigin: string;
  try {
    supabaseOrigin = new URL(supabaseUrl).origin;
  } catch {
    return undefined;
  }

  if (window.location.origin === supabaseOrigin) return undefined;

  return (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (rawUrl.startsWith(supabaseOrigin)) {
      const proxiedUrl = `${window.location.origin}/supabase-proxy${rawUrl.slice(supabaseOrigin.length)}`;
      if (input instanceof Request) {
        return fetch(new Request(proxiedUrl, input), init);
      }
      return fetch(proxiedUrl, init);
    }

    return fetch(input, init);
  };
}

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const proxyFetch = createLocalhostProxyFetch(url);
  return createBrowserClient(url, anonKey, proxyFetch ? { global: { fetch: proxyFetch } } : undefined);
}
