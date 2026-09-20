"use client";

import { useEffect } from "react";
import { API } from "@/lib/api";

/**
 * Pings /v1/health while the tab is visible so Render's free tier
 * doesn't cold-start in the middle of a demo.
 */
export function useKeepAlive(intervalMs = 4 * 60 * 1000) {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === "visible") {
        fetch(`${API}/v1/health`).catch(() => {});
      }
    };
    ping();
    const id = setInterval(ping, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs]);
}
