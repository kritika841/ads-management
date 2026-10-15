"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { Profile } from "@/lib/types";
import {
  IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  getFriendlyRouteName,
  type UserSessionActivity
} from "@/lib/user-sessions-shared";

const SESSION_STORAGE_KEY = "adflow_session_id";
const LAST_ACTIVE_STORAGE_KEY = "adflow_session_last_active";

export function UserSessionTracker({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const sessionIdRef = useRef<string | null>(null);
  const isIdleRef = useRef<boolean>(false);
  const lastInteractionRef = useRef<number>(Date.now());
  const lastPathnameRef = useRef<string>(pathname);
  const pendingActivitiesRef = useRef<UserSessionActivity[]>([]);

  // Function to start a fresh session on the server
  const startSession = async (path: string, actionLabel?: string) => {
    try {
      const res = await fetch("/api/user-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          path,
          actionLabel: actionLabel || `Opened ${getFriendlyRouteName(path)}`
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.session?.id) {
          sessionIdRef.current = data.session.id;
          isIdleRef.current = false;
          lastInteractionRef.current = Date.now();
          try {
            sessionStorage.setItem(SESSION_STORAGE_KEY, data.session.id);
            localStorage.setItem(LAST_ACTIVE_STORAGE_KEY, String(Date.now()));
          } catch {
            // Storage quota/private browsing safe
          }
        }
      }
    } catch (err) {
      console.warn("Failed to start user session:", err);
    }
  };

  // Function to send a heartbeat / touch
  const sendHeartbeat = async (activities?: UserSessionActivity[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;

    const toSend = activities && activities.length > 0 ? activities : pendingActivitiesRef.current;
    pendingActivitiesRef.current = [];

    try {
      await fetch("/api/user-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "heartbeat",
          sessionId: sid,
          activities: toSend
        })
      });
      try {
        localStorage.setItem(LAST_ACTIVE_STORAGE_KEY, String(Date.now()));
      } catch {
        // Safe
      }
    } catch {
      // Non-fatal, will retry next interval
      if (toSend && toSend.length > 0) {
        pendingActivitiesRef.current.push(...toSend);
      }
    }
  };

  // Function to checkout session on 5m idle
  const handleIdleCheckout = async () => {
    const sid = sessionIdRef.current;
    if (!sid || isIdleRef.current) return;

    isIdleRef.current = true;
    sessionIdRef.current = null;

    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Safe
    }

    try {
      await fetch("/api/user-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "idle_checkout",
          sessionId: sid,
          endReason: "idle_5m"
        })
      });
    } catch (err) {
      console.warn("Failed to record idle checkout:", err);
    }
  };

  // Wake up when user becomes active after idle
  const handleUserActivity = () => {
    const now = Date.now();
    lastInteractionRef.current = now;

    if (isIdleRef.current) {
      // User returned! Start a fresh session without interrupting or prompting
      isIdleRef.current = false;
      void startSession(window.location.pathname, "Resumed activity after idle");
    }
  };

  // Route change tracking
  useEffect(() => {
    if (pathname !== lastPathnameRef.current) {
      lastPathnameRef.current = pathname;
      lastInteractionRef.current = Date.now();

      const activity: UserSessionActivity = {
        timestamp: new Date().toISOString(),
        type: "page_view",
        description: `Navigated to ${getFriendlyRouteName(pathname)}`,
        path: pathname
      };

      if (isIdleRef.current || !sessionIdRef.current) {
        // Start fresh session with the new page
        isIdleRef.current = false;
        void startSession(pathname, `Opened ${getFriendlyRouteName(pathname)}`);
      } else {
        void sendHeartbeat([activity]);
      }
    }
  }, [pathname]);

  // Main lifecycle: setup event listeners, idle checker, and heartbeat
  useEffect(() => {
    // Check if there was an active session in sessionStorage
    let savedSessionId: string | null = null;
    let lastActiveMs = 0;

    try {
      savedSessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
      const storedLast = localStorage.getItem(LAST_ACTIVE_STORAGE_KEY);
      if (storedLast) lastActiveMs = Number(storedLast);
    } catch {
      // Safe
    }

    const now = Date.now();
    const timeSinceLastActive = now - lastActiveMs;

    if (savedSessionId && lastActiveMs > 0 && timeSinceLastActive < IDLE_TIMEOUT_MS) {
      // Reuse existing session
      sessionIdRef.current = savedSessionId;
      isIdleRef.current = false;
      lastInteractionRef.current = now;
      void sendHeartbeat([
        {
          timestamp: new Date().toISOString(),
          type: "page_view",
          description: `Active on ${getFriendlyRouteName(pathname)}`,
          path: pathname
        }
      ]);
    } else {
      // If previous session exceeded idle timeout, close it and start fresh
      if (savedSessionId && timeSinceLastActive >= IDLE_TIMEOUT_MS) {
        try {
          void fetch("/api/user-sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "idle_checkout",
              sessionId: savedSessionId,
              endReason: "idle_5m"
            })
          });
        } catch {
          // Safe
        }
      }
      // Start fresh session
      void startSession(pathname);
    }

    // User interaction events: mousemove, keydown, click, scroll, touchstart
    let throttleTimeout: NodeJS.Timeout | null = null;
    const throttledActivityListener = () => {
      if (!throttleTimeout) {
        handleUserActivity();
        throttleTimeout = setTimeout(() => {
          throttleTimeout = null;
        }, 1000); // Throttle to max once per second
      }
    };

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click", "wheel"];
    for (const ev of events) {
      window.addEventListener(ev, throttledActivityListener, { passive: true });
    }

    // Periodic idle checker (every 5 seconds)
    const idleCheckInterval = setInterval(() => {
      if (!isIdleRef.current && sessionIdRef.current) {
        const elapsed = Date.now() - lastInteractionRef.current;
        if (elapsed >= IDLE_TIMEOUT_MS) {
          void handleIdleCheckout();
        }
      }
    }, 5000);

    // Periodic active heartbeat (every 30 seconds)
    const heartbeatInterval = setInterval(() => {
      if (!isIdleRef.current && sessionIdRef.current) {
        void sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Page hide / unload handling
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && sessionIdRef.current) {
        const sid = sessionIdRef.current;
        const payload = JSON.stringify({
          action: "heartbeat",
          sessionId: sid,
          activities: pendingActivitiesRef.current
        });
        pendingActivitiesRef.current = [];
        try {
          if (navigator.sendBeacon) {
            navigator.sendBeacon("/api/user-sessions", payload);
          } else {
            void fetch("/api/user-sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload,
              keepalive: true
            });
          }
        } catch {
          // Safe
        }
      } else if (document.visibilityState === "visible") {
        handleUserActivity();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, throttledActivityListener);
      }
      if (throttleTimeout) clearTimeout(throttleTimeout);
      clearInterval(idleCheckInterval);
      clearInterval(heartbeatInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [profile.id]);

  // Non-visual component, returns null
  return null;
}
