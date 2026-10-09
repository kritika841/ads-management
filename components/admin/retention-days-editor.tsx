"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, formatRetentionDays } from "@/lib/retention";

/**
 * Inline "N days" editor. Read-only for non-admins; admins get a pencil that turns the value into
 * a number input with Save / Cancel. The caller owns persistence through `onSave`.
 */
export function RetentionDaysEditor({
  value,
  editable,
  saving,
  onSave,
  ariaLabel,
  valueClassName
}: {
  value: number;
  editable: boolean;
  saving?: boolean;
  onSave: (days: number) => Promise<boolean> | boolean;
  ariaLabel: string;
  valueClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const parsed = Number(draft);
  const valid = Number.isInteger(parsed) && parsed >= MIN_RETENTION_DAYS && parsed <= MAX_RETENTION_DAYS;
  const working = busy || Boolean(saving);

  async function commit() {
    if (!valid || working) return;
    if (parsed === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const ok = await onSave(parsed);
      if (ok) setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("text-2xl font-semibold text-foreground", valueClassName)}>{formatRetentionDays(value)}</span>
        {editable ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            title="Edit retention days"
            aria-label={`Edit ${ariaLabel}`}
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          min={MIN_RETENTION_DAYS}
          max={MAX_RETENTION_DAYS}
          step={1}
          value={draft}
          autoFocus
          aria-label={ariaLabel}
          aria-invalid={!valid}
          disabled={working}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commit();
            if (event.key === "Escape") setEditing(false);
          }}
          className="h-8 w-20 text-sm"
        />
        <span className="text-xs text-muted-foreground">days</span>
        <Button type="button" size="icon" className="size-8" disabled={!valid || working} onClick={() => void commit()} title="Save" aria-label="Save retention">
          {working ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" disabled={working} onClick={() => setEditing(false)} title="Cancel" aria-label="Cancel">
          <X className="size-3.5" aria-hidden />
        </Button>
      </span>
      {!valid ? <span className="text-[11px] text-destructive">Enter {MIN_RETENTION_DAYS}–{MAX_RETENTION_DAYS} whole days.</span> : null}
    </span>
  );
}
