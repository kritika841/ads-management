"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type VideoTimestampContextValue = {
  hasVideo: boolean;
  registerVideo: (video: HTMLVideoElement | null) => void;
  currentTime: () => number | null;
  seekTo: (seconds: number) => void;
};

const VideoTimestampContext = createContext<VideoTimestampContextValue>({
  hasVideo: false,
  registerVideo: () => undefined,
  currentTime: () => null,
  seekTo: () => undefined
});

export function VideoTimestampProvider({ children }: { children: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const registerVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    setHasVideo(Boolean(video));
  }, []);
  const currentTime = useCallback(() => videoRef.current?.currentTime ?? null, []);
  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds);
    void video.play().catch(() => undefined);
  }, []);
  const value = useMemo(() => ({ hasVideo, registerVideo, currentTime, seekTo }), [currentTime, hasVideo, registerVideo, seekTo]);
  return <VideoTimestampContext.Provider value={value}>{children}</VideoTimestampContext.Provider>;
}

export function useVideoTimestamp() {
  return useContext(VideoTimestampContext);
}

export function formatVideoTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
