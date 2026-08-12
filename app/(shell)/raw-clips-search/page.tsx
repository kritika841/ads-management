"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { BadgeAlert, Clapperboard, Clock3, ImageOff, Search } from "lucide-react";

interface ClipResult {
  raw_clip_id: string;
  ad_id: string;
  name: string | null;
  raw_footage_url: string;
  resolved_video_url: string | null;
  thumbnail_url: string | null;
  start_seconds: number;
  end_seconds: number;
  visual_description: string;
  spoken_text: string;
  similarity: number;
}

type RawClipStatusFilter = "all" | "done" | "pending" | "error";

interface RawClipBrowseItem {
  id: string;
  ad_id: string;
  name: string | null;
  raw_footage_url: string;
  resolved_video_url: string | null;
  thumbnail_url: string | null;
  segment_ingest_status: "pending" | "processing" | "done" | "error" | null;
  segment_ingest_error: string | null;
  created_at: string;
  preview_visual_description: string | null;
}

interface RawClipBrowseResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  totalClips: number;
  taggedCount: number;
  items: RawClipBrowseItem[];
}

const PAGE_SIZE = 24;
const GRID_CLASS = "grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]";

const statusButtonLabels: Array<{ value: RawClipStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "done", label: "Done" },
  { value: "pending", label: "Pending" },
];

async function readJsonResponse<T>(res: Response): Promise<T & { error?: string }> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const body = await res.text();
    throw new Error(body.startsWith("<!DOCTYPE") ? "The server returned an HTML error page instead of JSON." : "The server returned an unexpected response.");
  }

  return (await res.json()) as T & { error?: string };
}

function statusStyles(status: RawClipBrowseItem["segment_ingest_status"]) {
  switch (status) {
    case "done":
      return "bg-success/15 text-success ring-success/30";
    case "processing":
      return "bg-primary/15 text-primary ring-primary/30";
    case "error":
      return "bg-destructive/10 text-destructive ring-destructive/30";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

function formatTimestamp(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function clipHref(clip: Pick<ClipResult, "raw_footage_url" | "resolved_video_url"> | Pick<RawClipBrowseItem, "raw_footage_url" | "resolved_video_url">) {
  return clip.resolved_video_url || clip.raw_footage_url;
}

function ClipThumbnail({ src, alt }: { src: string | null; alt: string }) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted via-muted/70 to-card text-muted-foreground">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="rounded-full border border-border/70 bg-background/70 p-3 shadow-sm">
            <ImageOff className="size-5" aria-hidden />
          </div>
          <span className="text-[11px] font-medium uppercase tracking-[0.24em]">No thumbnail</span>
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      onError={() => setHasError(true)}
    />
  );
}

function ClipCardShell({
  href,
  thumbnailUrl,
  title,
  caption,
  meta,
  badge,
  children,
}: {
  href: string;
  thumbnailUrl: string | null;
  title: string;
  caption: string;
  meta: ReactNode;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-ring/40 hover:shadow-lg"
    >
      <div className="relative aspect-video overflow-hidden bg-muted">
        <ClipThumbnail src={thumbnailUrl} alt={title} />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/0 to-transparent" />
        <div className="absolute left-3 top-3">{badge}</div>
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3 text-[11px] font-medium text-white/90">
          <div className="rounded-full bg-black/45 px-2.5 py-1 backdrop-blur-sm">{meta}</div>
          <div className="rounded-full bg-black/45 px-2.5 py-1 backdrop-blur-sm opacity-0 transition-opacity group-hover:opacity-100">Open clip</div>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <p className="line-clamp-1 text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{caption}</p>
        </div>
        {children}
      </div>
    </a>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="aspect-video bg-muted" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-4 w-5/6 rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-6 w-20 rounded-full bg-muted" />
          <div className="h-6 w-24 rounded-full bg-muted" />
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className={GRID_CLASS}>
      {Array.from({ length: 8 }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}

function EmptyState({ title, description, icon }: { title: string; description: string; icon: ReactNode }) {
  return (
    <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
      <div className="max-w-sm space-y-3">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm">{icon}</div>
        <div>
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

export default function RawClipsSearchPage() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [results, setResults] = useState<ClipResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [browseItems, setBrowseItems] = useState<RawClipBrowseItem[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseTotalPages, setBrowseTotalPages] = useState(1);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseStatus, setBrowseStatus] = useState<RawClipStatusFilter>("all");

  useEffect(() => {
    if (activeQuery.trim()) return;

    let cancelled = false;
    async function loadBrowse() {
      setBrowseLoading(true);
      setBrowseError(null);
      try {
        const params = new URLSearchParams({
          page: String(browsePage),
          pageSize: String(PAGE_SIZE),
          status: browseStatus,
        });
        const res = await fetch(`/api/raw-clips?${params.toString()}`);
        const data = await readJsonResponse<RawClipBrowseResponse>(res);
        if (!res.ok) {
          throw new Error(data.error || "Could not load clips.");
        }
        if (!cancelled) {
          setBrowseItems(data.items || []);
          setBrowseTotalPages(data.totalPages || 1);
          setBrowseTotal(data.total || 0);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setBrowseError(err instanceof Error ? err.message : "Could not load clips.");
          setBrowseItems([]);
        }
      } finally {
        if (!cancelled) setBrowseLoading(false);
      }
    }

    void loadBrowse();
    return () => {
      cancelled = true;
    };
  }, [activeQuery, browsePage, browseStatus]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setActiveQuery("");
      setResults([]);
      setSearchError(null);
      return;
    }

    setActiveQuery(trimmedQuery);
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await fetch("/api/search-clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmedQuery }),
      });
      const data = await readJsonResponse<{ results: ClipResult[] }>(res);
      if (!res.ok) {
        setSearchError(data.error || "Search failed.");
        setResults([]);
      } else {
        setResults(data.results || []);
      }
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : "Something went wrong.");
      setResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  const browseMode = !activeQuery.trim();

  return (
    <main className="page-container py-10">
      <section className="panel border-border/70 bg-card/95 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Clapperboard className="size-3.5" aria-hidden />
              Raw clips library
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">Raw Clips Library</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Search by what you see or hear, then open the exact source clip directly.
              </p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="flex w-full flex-col gap-3 sm:flex-row lg:max-w-2xl">
            <label className="sr-only" htmlFor="raw-clips-search-input">Describe the scene you need</label>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                id="raw-clips-search-input"
                type="text"
                value={query}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setQuery(nextValue);
                  if (!nextValue.trim()) {
                    setActiveQuery("");
                    setResults([]);
                    setSearchError(null);
                  }
                }}
                placeholder="Describe the scene you need..."
                className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm text-foreground shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <Button type="submit" disabled={searchLoading} className="h-11 px-5 sm:w-auto">
              {searchLoading ? "Searching..." : "Search clips"}
            </Button>
          </form>
        </div>

        {searchError && (
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <BadgeAlert className="size-4" aria-hidden />
            {searchError}
          </div>
        )}
      </section>

      {browseMode ? (
        <section className="mt-6 space-y-5">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:flex-row md:items-center md:justify-between">
            <div>

              <p className="mt-1 text-xs text-muted-foreground">
                Showing {browseTotal} filtered results.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {statusButtonLabels.map((item) => (
                <Button
                  key={item.value}
                  type="button"
                  size="sm"
                  variant={browseStatus === item.value ? "primary" : "secondary"}
                  onClick={() => {
                    setBrowseStatus(item.value);
                    setBrowsePage(1);
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          {browseError && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {browseError}
            </div>
          )}

          {browseLoading ? (
            <SkeletonGrid />
          ) : browseItems.length === 0 ? (
            <EmptyState
              title="No clips match this filter yet"
              description="Try a different status filter or come back after the next ingest run finishes."
              icon={<Clapperboard className="size-5" aria-hidden />}
            />
          ) : (
            <div className={GRID_CLASS}>
              {browseItems.map((clip) => (
                <ClipCardShell
                  key={clip.id}
                  href={clipHref(clip)}
                  thumbnailUrl={clip.thumbnail_url ? `/api/raw-clips/${clip.id}/thumbnail` : null}
                  title={clip.name || "Untitled clip"}
                  caption={
                    clip.segment_ingest_status === "done"
                      ? clip.preview_visual_description || "Tagged clip ready for search."
                      : clip.segment_ingest_status === "processing"
                        ? "Tagging in progress..."
                        : clip.segment_ingest_status === "error"
                          ? clip.segment_ingest_error || "Tagging failed."
                          : "Waiting to be tagged."
                  }
                  meta={<span>{new Date(clip.created_at).toLocaleDateString()}</span>}
                  badge={<span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${statusStyles(clip.segment_ingest_status)}`}>{clip.segment_ingest_status || "pending"}</span>}
                >
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{clip.preview_visual_description || "No preview description yet."}</span>
                    {clip.segment_ingest_status === "error" && clip.segment_ingest_error ? <span className="truncate text-destructive">{clip.segment_ingest_error}</span> : null}
                  </div>
                </ClipCardShell>
              ))}
            </div>
          )}

          {browseTotalPages > 1 && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={browsePage <= 1 || browseLoading}
                onClick={() => setBrowsePage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <p className="text-sm text-muted-foreground">
                Page {browsePage} of {browseTotalPages}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={browsePage >= browseTotalPages || browseLoading}
                onClick={() => setBrowsePage((current) => Math.min(browseTotalPages, current + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </section>
      ) : (
        <section className="mt-6 space-y-5">
          {searchLoading ? (
            <SkeletonGrid />
          ) : results.length === 0 ? (
            <EmptyState
              title="No matching clips found"
              description="Try describing the action, subject, or spoken line in the shot more specifically."
              icon={<Search className="size-5" aria-hidden />}
            />
          ) : (
            <div className={GRID_CLASS}>
              {results.map((clip) => (
                <ClipCardShell
                  key={clip.raw_clip_id}
                  href={clipHref(clip)}
                  thumbnailUrl={clip.thumbnail_url ? `/api/raw-clips/${clip.raw_clip_id}/thumbnail` : null}
                  title={clip.name || "Untitled clip"}
                  caption={clip.visual_description}
                  meta={<span>{formatTimestamp(clip.start_seconds)}–{formatTimestamp(clip.end_seconds)}</span>}
                  badge={<span className="rounded-full bg-primary/90 px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow-sm">{(clip.similarity * 100).toFixed(0)}% match</span>}
                >
                  <div className="space-y-2 text-xs text-muted-foreground">
                    {clip.spoken_text ? (
                      <p className="line-clamp-2 italic text-foreground/80">“{clip.spoken_text}”</p>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <Clock3 className="size-3.5" aria-hidden />
                      <span>
                        {formatTimestamp(clip.start_seconds)}–{formatTimestamp(clip.end_seconds)}
                      </span>
                    </div>
                  </div>
                </ClipCardShell>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
