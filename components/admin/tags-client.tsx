"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Hash, Loader2, Lock, Search, Tags, Trash2 } from "lucide-react";
import { deleteTag } from "@/app/actions/tags";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ProductionStageBadge } from "@/components/workflow/production-stage";
import { runServerAction } from "@/lib/client-action";
import type { TagOverview } from "@/lib/tags-data";
import { cn } from "@/lib/utils";

type Sort = "name" | "count";

export function TagsClient({ tags, initialTagId }: { tags: TagOverview[]; initialTagId: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("count");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(initialTagId);
  const [confirming, setConfirming] = useState<TagOverview | null>(null);
  const [isPending, startTransition] = useTransition();

  const liveTags = useMemo(() => tags.filter((tag) => !removed.has(tag.id)), [tags, removed]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^#/, "");
    return liveTags
      .filter((tag) => !needle || tag.name.toLowerCase().includes(needle))
      .sort((a, b) => (sort === "count" ? b.creatives.length - a.creatives.length || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)));
  }, [liveTags, query, sort]);

  // Keep a valid selection: fall back to the first visible tag.
  useEffect(() => {
    if (!selectedId || !liveTags.some((tag) => tag.id === selectedId)) setSelectedId(visible[0]?.id ?? null);
  }, [liveTags, selectedId, visible]);

  const selected = liveTags.find((tag) => tag.id === selectedId) ?? null;
  const unused = liveTags.filter((tag) => tag.creatives.length === 0).length;

  function select(tag: TagOverview) {
    setSelectedId(tag.id);
    const url = new URL(window.location.href);
    url.searchParams.set("tag", tag.name);
    window.history.replaceState(null, "", url);
  }

  function confirmDelete() {
    const tag = confirming;
    if (!tag) return;
    startTransition(async () => {
      const response = await runServerAction(() => deleteTag(tag.id));
      if (!response.ok) {
        toast({ title: "Tag not deleted", description: response.message ?? "Unable to delete the tag.", tone: "error" });
        return;
      }
      setConfirming(null);
      setRemoved((current) => new Set(current).add(tag.id));
      toast({ title: "Tag deleted", description: response.message, tone: "success" });
      router.refresh();
    });
  }

  if (!tags.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
        <Tags className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">No tags yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">Tags appear here as soon as they are added to a creative.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Tags" value={liveTags.length} />
        <Stat label="Tagged creatives" value={new Set(liveTags.flatMap((tag) => tag.creatives.map((creative) => creative.id))).size} />
        <Stat label="Unused tags" value={unused} hint={unused ? "Not on any live creative" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="All tags">
          <div className="flex items-center gap-2 border-b border-border p-3">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                id="tags-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tags"
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <select
              id="tags-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              aria-label="Sort tags"
              className="h-9 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
            >
              <option value="count">Most used</option>
              <option value="name">A–Z</option>
            </select>
          </div>
          <ul className="flex-1 overflow-y-auto p-1.5">
            {visible.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  onClick={() => select(tag)}
                  aria-current={tag.id === selectedId}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    tag.id === selectedId ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                  )}
                >
                  <Hash className="size-3.5 shrink-0 opacity-60" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{tag.name}</span>
                  {tag.protected ? <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="System tag" /> : null}
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", tag.creatives.length ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning")}>
                    {tag.creatives.length}
                  </span>
                </button>
              </li>
            ))}
            {!visible.length ? <li className="px-3 py-8 text-center text-sm text-muted-foreground">No tags match “{query}”.</li> : null}
          </ul>
        </section>

        <section className="min-h-[320px] overflow-hidden rounded-xl border border-border bg-card" aria-label="Creatives in tag">
          {selected ? (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-1.5 truncate text-lg font-semibold text-foreground"><Hash className="size-4 text-primary" aria-hidden />{selected.name}</h2>
                  <p className="text-xs text-muted-foreground">{selected.creatives.length} creative{selected.creatives.length === 1 ? "" : "s"}</p>
                </div>
                {selected.protected ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground"><Lock className="size-3" aria-hidden />System tag</span>
                ) : (
                  <Button id="tags-delete-button" variant="secondary" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setConfirming(selected)}>
                    <Trash2 className="size-4" aria-hidden />Delete tag
                  </Button>
                )}
              </header>
              {selected.creatives.length ? (
                <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
                  {selected.creatives.map((creative) => (
                    <li key={creative.id}>
                      <Link href={`/ads/${creative.id}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/60">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{creative.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{creative.campaign_name ?? "No campaign"}{creative.creator_name ? ` · ${creative.creator_name}` : ""}</span>
                        </span>
                        <ProductionStageBadge stage={creative.production_stage} className="shrink-0 bg-muted text-muted-foreground shadow-none" />
                        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-16 text-center text-sm text-muted-foreground">No live creatives use this tag.</p>
              )}
            </>
          ) : (
            <p className="px-5 py-16 text-center text-sm text-muted-foreground">Select a tag to see its creatives.</p>
          )}
        </section>
      </div>

      {confirming ? (
        <Modal open labelledBy="delete-tag-title" onClose={() => (isPending ? undefined : setConfirming(null))} className="flex items-center justify-center p-4">
          <section className="w-full max-w-md rounded-xl border border-border bg-card shadow-float dark:shadow-none" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-border px-5 py-4">
              <h2 id="delete-tag-title" className="text-lg font-semibold text-foreground">Delete #{confirming.name}?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {confirming.creatives.length
                  ? `The tag is removed from ${confirming.creatives.length} creative${confirming.creatives.length === 1 ? "" : "s"}. The creatives themselves are not affected.`
                  : "This tag isn't used by any live creative."}
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
              <Button variant="secondary" disabled={isPending} onClick={() => setConfirming(null)}>Cancel</Button>
              <Button id="tags-confirm-delete" variant="danger" disabled={isPending} onClick={confirmDelete}>
                {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}Delete tag
              </Button>
            </div>
          </section>
        </Modal>
      ) : null}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
