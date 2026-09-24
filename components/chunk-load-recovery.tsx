"use client";

import { useEffect } from "react";
import { isNextChunkUrl, isStaleApplicationFailure } from "@/lib/chunk-load";

const RELOAD_GUARD = "adflow:chunk-reload";
const RELOAD_COUNT = "adflow:chunk-reload-count";

export function ChunkLoadRecovery() {
  useEffect(() => {
    const recover = () => {
      const last = window.sessionStorage.getItem(RELOAD_GUARD);
      const count = Number(window.sessionStorage.getItem(RELOAD_COUNT) || "0");
      const now = Date.now();

      // Loop prevention: allow up to 2 automatic reloads in a 15-second window
      if (last && now - Number(last) < 15_000 && count >= 2) return;

      window.sessionStorage.setItem(RELOAD_GUARD, String(now));
      window.sessionStorage.setItem(RELOAD_COUNT, String(count + 1));

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
      if (target instanceof HTMLScriptElement && isNextChunkUrl(target.src)) {
        recover();
        return;
      }
      if (target instanceof HTMLLinkElement && target.rel === "stylesheet" && isNextChunkUrl(target.href)) {
        recover();
        return;
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isStaleApplicationFailure(event.reason)) {
        recover();
      }
    };

    window.addEventListener("error", handleError, true);
    window.addEventListener("unhandledrejection", handleRejection);

    // Reset reload count once page has been successfully running for 10 seconds
    const clearGuard = window.setTimeout(() => {
      window.sessionStorage.removeItem(RELOAD_GUARD);
      window.sessionStorage.removeItem(RELOAD_COUNT);
    }, 10_000);

    return () => {
      window.clearTimeout(clearGuard);
      window.removeEventListener("error", handleError, true);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
