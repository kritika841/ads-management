"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MultiSelectOption = { value: string; label: string };

/**
 * Checkbox dropdown filter with integrated real-time search.
 * Any number of values can be ticked, the trigger summarises the selection,
 * the search bar filters available options quickly, and the panel closes
 * on outside click / Escape / "Done".
 */
export function MultiSelectFilter({
  label,
  values,
  onChange,
  options,
  allLabel,
  optionPrefix = ""
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  options: MultiSelectOption[];
  allLabel?: string;
  /** Prepended to each option label in the summary and list (e.g. "#" for tags). */
  optionPrefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      return;
    }
    // Focus search input on open
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);

    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        opt.value.toLowerCase().includes(query)
    );
  }, [options, searchQuery]);

  const labelFor = (value: string) => `${optionPrefix}${options.find((option) => option.value === value)?.label ?? value}`;
  const summary = values.length ? values.map(labelFor).join(", ") : allLabel ?? `All ${label.toLowerCase()}`;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <div className="relative" ref={containerRef}>
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          id={`filter-${slug}-trigger`}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-sm text-foreground transition-[border-color,box-shadow,background-color] duration-150 hover:border-ring/50 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          onClick={() => setOpen((current) => !current)}
        >
          <span className={cn("block min-w-0 truncate", values.length ? "text-foreground" : "text-muted-foreground")}>{summary}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
            {values.length > 1 ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{values.length}</span> : null}
            ▾
          </span>
        </button>
      </div>
      {open ? (
        <div className="absolute left-0 right-0 z-50 mt-2 w-full min-w-[220px] rounded-xl border border-border bg-card p-3 shadow-soft">
          {/* Integrated search bar inside the filter */}
          <div className="relative mb-2.5">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3" aria-hidden />
              </button>
            ) : null}
          </div>

          <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1" role="listbox" aria-multiselectable="true" aria-label={label}>
            {filteredOptions.length ? filteredOptions.map((option) => (
              <label key={option.value} className="flex items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-sm hover:border-ring/50 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary shadow-sm focus:ring-ring"
                  checked={values.includes(option.value)}
                  onChange={(event) => {
                    if (event.target.checked) onChange(Array.from(new Set([...values, option.value])));
                    else onChange(values.filter((value) => value !== option.value));
                  }}
                />
                <span className="truncate">{optionPrefix}{option.label}</span>
              </label>
            )) : (
              <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                {searchQuery ? `No matching ${label.toLowerCase()} found.` : "No options available."}
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
            <button type="button" className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40" disabled={!values.length} onClick={() => onChange([])}>Clear</button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
