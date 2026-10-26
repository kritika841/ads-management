"use client";

import { useEffect, useState } from "react";

// Last-resort boundary. Catches failures in the root layout / Next.js router itself
// (e.g. React error #310 thrown from the App Router after a failed server refresh),
// which no nested error.tsx can catch. Recovers with a bounded number of full reloads.
const KEY = "adflow_global_error_reloads";
const WINDOW_MS = 60_000;
const MAX_AUTO_RELOADS = 2;

function nextReloadAllowed(): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    const now = Date.now();
    const state = raw ? (JSON.parse(raw) as { count: number; at: number }) : { count: 0, at: now };
    const count = now - state.at > WINDOW_MS ? 0 : state.count;
    if (count >= MAX_AUTO_RELOADS) return false;
    sessionStorage.setItem(KEY, JSON.stringify({ count: count + 1, at: count === 0 ? now : state.at }));
    return true;
  } catch {
    return false;
  }
}

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    console.error("[GlobalError]", error);
    if (!nextReloadAllowed()) {
      setGaveUp(true);
      return;
    }
    const delay = navigator.onLine ? 1_500 : 0;
    const reload = () => window.location.reload();
    if (!navigator.onLine) {
      window.addEventListener("online", reload, { once: true });
      return () => window.removeEventListener("online", reload);
    }
    const t = setTimeout(reload, delay);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0b0d12",
          color: "#e6e8ee"
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            {gaveUp ? "AdFlow couldn't reconnect" : "Reconnecting to AdFlow…"}
          </h1>
          <p style={{ fontSize: 14, opacity: 0.7, marginTop: 8 }}>
            {gaveUp
              ? "The server is temporarily unavailable. Your work is saved."
              : "A temporary connection issue occurred. Restoring your view."}
          </p>
          {gaveUp ? (
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem(KEY);
                window.location.reload();
              }}
              style={{
                marginTop: 16,
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#6d5efc",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Reload
            </button>
          ) : null}
          {error?.digest ? (
            <p style={{ fontSize: 11, opacity: 0.4, marginTop: 16, fontFamily: "monospace" }}>Ref: {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
