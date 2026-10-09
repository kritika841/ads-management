"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterOption = {
  value: string;
  label: string;
};

type SingleSelectProps = {
  isMulti?: false;
  value: string;
  onChange: (next: string) => void;
};

type MultiSelectProps = {
  isMulti: true;
  value: string[];
  onChange: (next: string[]) => void;
};

export type SearchableFilterDropdownProps = {
  label: string;
  options: FilterOption[];
  allLabel?: string;
  prefix?: string;
  className?: string;
} & (SingleSelectProps | MultiSelectProps);

export function SearchableFilterDropdown(props: SearchableFilterDropdownProps) {
  const {
    label,
    options,
    allLabel = `All ${label.toLowerCase()}`,
    prefix = "",
    className
  } = props;
  const isMulti = props.isMulti;
  const value = props.value;
  const onChange = (next: string | string[]) => {
    if (props.isMulti) {
      props.onChange(next as string[]);
    } else {
      props.onChange(next as string);
    }
  };
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedArray = useMemo(() => {
    if (Array.isArray(value)) return value;
    if (!value || value === "all") return [];
    return [value];
  }, [value]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      return;
    }
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 40);

    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q)
    );
  }, [options, searchQuery]);

  const labelFor = (val: string) => {
    const found = options.find((opt) => opt.value === val);
    return found ? `${prefix}${found.label}` : `${prefix}${val}`;
  };

  const displayText = useMemo(() => {
    if (isMulti) {
      if (selectedArray.length === 0) return allLabel;
      if (selectedArray.length === 1) return labelFor(selectedArray[0]);
      return `${selectedArray.length} selected`;
    }
    if (!value || value === "all") return allLabel;
    return labelFor(value as string);
  }, [isMulti, selectedArray, value, allLabel]);

  const handleSelectOption = (optValue: string) => {
    if (isMulti) {
      if (selectedArray.includes(optValue)) {
        onChange(selectedArray.filter((v) => v !== optValue));
      } else {
        onChange([...selectedArray, optValue]);
      }
    } else {
      onChange(optValue);
      setOpen(false);
    }
  };

  const handleClear = () => {
    if (isMulti) {
      onChange([]);
    } else {
      onChange("all");
    }
    setOpen(false);
  };

  const hasSelection = isMulti ? selectedArray.length > 0 : value && value !== "all";

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
        {label}
      </label>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-card px-2.5 text-xs text-foreground transition-colors hover:border-ring/50 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring",
          hasSelection && "border-primary/50 font-medium"
        )}
      >
        <span className="truncate text-left">{displayText}</span>
        <div className="flex items-center gap-1 text-muted-foreground shrink-0">
          {isMulti && selectedArray.length > 1 ? (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.2 text-[10px] font-semibold text-primary">
              {selectedArray.length}
            </span>
          ) : null}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[200px] rounded-xl border border-border bg-card p-2 shadow-soft">
          {/* Integrated search bar inside the dropdown */}
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="h-7 w-full rounded-md border border-input bg-background pl-8 pr-6 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>

          {/* Options list */}
          <div className="max-h-52 overflow-y-auto space-y-0.5 text-xs" role="listbox">
            {/* "All" reset option for single select */}
            {!isMulti ? (
              <button
                type="button"
                onClick={() => {
                  onChange("all");
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                  (!value || value === "all") && "bg-muted font-medium text-foreground"
                )}
              >
                <span>{allLabel}</span>
                {(!value || value === "all") ? <Check className="size-3.5 text-primary" /> : null}
              </button>
            ) : null}

            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = isMulti
                  ? selectedArray.includes(opt.value)
                  : value === opt.value;

                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelectOption(opt.value)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                      isSelected && "bg-muted font-medium text-foreground"
                    )}
                  >
                    <span className="truncate">
                      {prefix}
                      {opt.label}
                    </span>
                    {isSelected ? <Check className="size-3.5 text-primary shrink-0" /> : null}
                  </button>
                );
              })
            ) : (
              <p className="py-3 text-center text-xs text-muted-foreground">
                No matching {label.toLowerCase()}.
              </p>
            )}
          </div>

          {/* Footer with Clear button */}
          {hasSelection ? (
            <div className="mt-2 flex items-center justify-between border-t border-border pt-1.5">
              <button
                type="button"
                onClick={handleClear}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                Clear filter
              </button>
              {isMulti ? (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground"
                >
                  Done
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
