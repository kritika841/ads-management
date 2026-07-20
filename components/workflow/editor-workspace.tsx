"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, Play, Send, X } from "lucide-react";
import { startEditing, submitEditedVideo } from "@/app/actions/ads";
import { runServerAction } from "@/lib/client-action";
import { RequestedChanges } from "@/components/review/requested-changes";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { parseGoogleDriveVideoFileUrl } from "@/lib/drive-urls";
import type { ResubmissionFeedbackItem } from "@/lib/resubmission";
import type { AdWithRelations } from "@/lib/types";
import { formatDateOnly } from "@/lib/utils";

export function EditorWorkspace({ ad, feedback, inProgressCount, maxConcurrentEdits }: { ad: AdWithRelations; feedback: ResubmissionFeedbackItem[]; inProgressCount: number; maxConcurrentEdits: number }) {
  const atCapacity = inProgressCount >= maxConcurrentEdits;
  const router = useRouter();
  const resubmitting = ad.production_stage === "changes_requested";
  const [driveUrl, setDriveUrl] = useState(resubmitting ? ad.drive_url ?? "" : "");
  const [driveUrlError, setDriveUrlError] = useState<string | null>(null);
  const [editorNotes, setEditorNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDriveUrlChange(value: string) {
    setDriveUrl(value);
    if (!value.trim()) {
      setDriveUrlError(null);
      return;
    }
    const validation = parseGoogleDriveVideoFileUrl(value);
    setDriveUrlError(validation.error);
  }

  function begin() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => startEditing(ad.id));
      setMessage(response.ok ? "Editing started." : response.message ?? "Unable to start editing.");
      if (response.ok) router.refresh();
    });
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => submitEditedVideo({ adId: ad.id, driveUrl, editorNotes, changesConfirmed: confirmed }));
      if (!response.ok) {
        setMessage(response.message ?? "Unable to submit the edited video.");
        return;
      }
      setConfirmationOpen(false);
      router.refresh();
    });
  }

  return (
    <section id="editor-task" className="panel scroll-mt-24 overflow-hidden">
      <div className="border-b border-border p-5"><h2 className="section-heading">Editing task</h2><p className="mt-1 text-sm text-muted-foreground">The script and raw footage are read-only. Submit only when the final video is ready.</p></div>
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Script</p>
          <div className="prose prose-sm mt-2 max-h-80 max-w-none overflow-y-auto rounded-md border border-border bg-muted p-4" dangerouslySetInnerHTML={{ __html: ad.script_html ?? "<p>No script provided.</p>" }} />
        </div>
        <div className="space-y-4">
          <div><p className="text-xs font-semibold uppercase text-muted-foreground">Raw footage</p>{ad.production_stage === "ready_for_edit" ? <p className="mt-2 text-sm text-muted-foreground">The raw footage link unlocks once you start editing.</p> : ad.raw_footage_url ? <a href={ad.raw_footage_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">Open Drive folder <ExternalLink className="size-4" aria-hidden /></a> : <p className="mt-2 text-sm text-destructive">Raw footage link is missing.</p>}</div>
          <dl className="grid gap-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Creator</dt><dd className="font-medium text-foreground">{ad.creator?.name ?? "Unassigned"}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Campaign</dt><dd className="font-medium text-foreground">{ad.campaign?.name ?? "No campaign"}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Deadline</dt><dd className={ad.deadline ? "font-medium text-foreground" : "text-muted-foreground"}>{ad.deadline ? formatDateOnly(ad.deadline) : "No deadline set"}</dd></div></dl>
        </div>
      </div>

      {ad.production_stage === "ready_for_edit" ? (
        <div className="border-t border-border bg-muted px-5 py-4">
          <p className="mb-3 text-sm text-muted-foreground">You have {inProgressCount} of {maxConcurrentEdits} videos in progress. {atCapacity ? "Submit one before starting another." : ""}</p>
          <Button disabled={isPending || !ad.raw_footage_url || atCapacity} onClick={begin}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}Start editing</Button>
        </div>
      ) : null}

      {(ad.production_stage === "editing" || resubmitting) ? <div className="border-t border-border p-5">{resubmitting ? <div className="mb-5"><RequestedChanges items={feedback} /></div> : null}<div className="grid gap-4 md:grid-cols-2"><Field label="Final edited video" hint="Must be a single Google Drive video file link — no folders or other websites.">
          <Input
            value={driveUrl}
            onChange={(event) => handleDriveUrlChange(event.target.value)}
            placeholder="https://drive.google.com/file/d/..."
            aria-invalid={Boolean(driveUrlError)}
          />
          {driveUrlError ? (
            <p className="mt-1.5 text-xs text-destructive" role="alert">{driveUrlError}</p>
          ) : null}
        </Field><Field label="Editing note" hint="Optional"><Textarea className="min-h-20" value={editorNotes} onChange={(event) => setEditorNotes(event.target.value)} placeholder="What changed or what should reviewers know?" /></Field></div><div className="mt-5 flex justify-end"><Button disabled={isPending || !driveUrl.trim() || Boolean(driveUrlError)} onClick={() => resubmitting ? setConfirmationOpen(true) : submit()}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}{resubmitting ? "Resubmit edited video" : "Submit edited video"}</Button></div></div> : null}

      {message ? <p className="mx-5 mb-5 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground" role="status">{message}</p> : null}

      {confirmationOpen ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="editor-resubmit-title"><section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card shadow-float dark:shadow-none"><div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4"><div><h2 id="editor-resubmit-title" className="text-lg font-semibold text-foreground">Confirm requested changes</h2><p className="mt-1 text-sm text-muted-foreground">Check every request before resubmitting.</p></div><Button size="icon" variant="ghost" className="size-9" title="Close" disabled={isPending} onClick={() => setConfirmationOpen(false)}><X className="size-5" aria-hidden /></Button></div><div className="space-y-4 p-5"><RequestedChanges items={feedback} compact /><label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted p-4"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><span className="block text-sm font-medium text-foreground">I confirm that I completed all requested changes.</span><span className="mt-0.5 block text-xs text-muted-foreground">A new version will be created and returned for review.</span></span></label>{message ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{message}</p> : null}</div><div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end"><Button variant="secondary" disabled={isPending} onClick={() => setConfirmationOpen(false)}>Continue editing</Button><Button disabled={isPending || !confirmed} onClick={submit}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}Confirm and resubmit</Button></div></section></div> : null}
    </section>
  );
}
