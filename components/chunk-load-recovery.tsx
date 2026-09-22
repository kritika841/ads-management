"use client";

import { useEffect } from "react";
import { isNextChunkUrl, isStaleApplicationFailure } from "@/lib/chunk-load";

const RELOAD_GUARD = "adflow:chunk-reload";

export function ChunkLoadRecovery() {
  useEffect(() => {
    const pageKey = `${window.location.pathname}${window.location.search}`;

    const recover = () => {
      const last = window.sessionStorage.getItem(RELOAD_GUARD);
      const now = Date.now();
      if (last && now - Number(last) < 15_000) return;
      window.sessionStorage.setItem(RELOAD_GUARD, String(now));
      const url = new URL(window.location.href);
      url.searchParams.set("_v", String(now));
      window.location.replace(url.toString());
    };

    const handleError = (event: Event) => {
      if (event instanceof ErrorEvent && isStaleApplicationFailure(event.error ?? event.message)) {
        recover();
        return;
      }

      const target = event.target;
      if (target instanceof HTMLScriptElement && isNextChunkUrl(target.src)) recover();
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isStaleApplicationFailure(event.reason)) recover();
    };

    window.addEventListener("error", handleError, true);
    window.addEventListener("unhandledrejection", handleRejection);

    // A page that remains mounted has loaded successfully, so a later stale
    // route transition may safely use the single automatic retry again.
    const clearGuard = window.setTimeout(() => {
      window.sessionStorage.removeItem(RELOAD_GUARD);
    }, 10_000);

    return () => {
      window.clearTimeout(clearGuard);
      window.removeEventListener("error", handleError, true);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
