"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, Play, Send, X } from "lucide-react";
import { startEditing, submitEditedVideo } from "@/app/actions/ads";
import { RequestedChanges } from "@/components/review/requested-changes";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { ResubmissionFeedbackItem } from "@/lib/resubmission";
import type { AdWithRelations } from "@/lib/types";
import { formatDateOnly } from "@/lib/utils";

export function EditorWorkspace({ ad, feedback, inProgressCount, maxConcurrentEdits }: { ad: AdWithRelations; feedback: ResubmissionFeedbackItem[]; inProgressCount: number; maxConcurrentEdits: number }) {
  const atCapacity = inProgressCount >= maxConcurrentEdits;
  const router = useRouter();
  const resubmitting = ad.production_stage === "changes_requested";
  const [driveUrl, setDriveUrl] = useState(resubmitting ? ad.drive_url ?? "" : "");
  const [editorNotes, setEditorNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function begin() {
    setMessage(null);
    startTransition(async () => {
      const response = await startEditing(ad.id);
      setMessage(response.ok ? "Editing started." : response.message ?? "Unable to start editing.");
      if (response.ok) router.refresh();
    });
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const response = await submitEditedVideo({ adId: ad.id, driveUrl, editorNotes, changesConfirmed: confirmed });
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
      <div className="border-b border-border p-5"><h2 className="section-heading">Editing task</h2><p className="mt-1 text-sm text-slate-500">The script and raw footage are read-only. Submit only when the final video is ready.</p></div>
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Script</p>
          <div className="prose prose-sm mt-2 max-h-80 max-w-none overflow-y-auto rounded-md border border-border bg-slate-50 p-4" dangerouslySetInnerHTML={{ __html: ad.script_html ?? "<p>No script provided.</p>" }} />
        </div>
        <div className="space-y-4">
          <div><p className="text-xs font-semibold uppercase text-slate-500">Raw footage</p>{ad.production_stage === "ready_for_edit" ? <p className="mt-2 text-sm text-slate-500">The raw footage link unlocks once you start editing.</p> : ad.raw_footage_url ? <a href={ad.raw_footage_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">Open Drive folder <ExternalLink className="size-4" aria-hidden /></a> : <p className="mt-2 text-sm text-rose-700">Raw footage link is missing.</p>}</div>
          <dl className="grid gap-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-slate-500">Creator</dt><dd className="font-medium text-slate-800">{ad.creator?.name ?? "Unassigned"}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Campaign</dt><dd className="font-medium text-slate-800">{ad.campaign?.name ?? "No campaign"}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Deadline</dt><dd className={ad.deadline ? "font-medium text-slate-800" : "text-slate-400"}>{ad.deadline ? formatDateOnly(ad.deadline) : "No deadline set"}</dd></div></dl>
        </div>
      </div>

      {ad.production_stage === "ready_for_edit" ? (
        <div className="border-t border-border bg-slate-50 px-5 py-4">
          <p className="mb-3 text-sm text-slate-500">You have {inProgressCount} of {maxConcurrentEdits} videos in progress. {atCapacity ? "Submit one before starting another." : ""}</p>
          <Button disabled={isPending || !ad.raw_footage_url || atCapacity} onClick={begin}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}Start editing</Button>
        </div>
      ) : null}

      {(ad.production_stage === "editing" || resubmitting) ? <div className="border-t border-border p-5">{resubmitting ? <div className="mb-5"><RequestedChanges items={feedback} /></div> : null}<div className="grid gap-4 md:grid-cols-2"><Field label="Final edited video"><Input value={driveUrl} onChange={(event) => setDriveUrl(event.target.value)} placeholder="https://drive.google.com/file/d/..." /></Field><Field label="Editing note" hint="Optional"><Textarea className="min-h-20" value={editorNotes} onChange={(event) => setEditorNotes(event.target.value)} placeholder="What changed or what should reviewers know?" /></Field></div><div className="mt-5 flex justify-end"><Button disabled={isPending || !driveUrl.trim()} onClick={() => resubmitting ? setConfirmationOpen(true) : submit()}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}{resubmitting ? "Resubmit edited video" : "Submit edited video"}</Button></div></div> : null}

      {message ? <p className="mx-5 mb-5 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700" role="status">{message}</p> : null}

      {confirmationOpen ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="editor-resubmit-title"><section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white shadow-float"><div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4"><div><h2 id="editor-resubmit-title" className="text-lg font-semibold text-slate-950">Confirm requested changes</h2><p className="mt-1 text-sm text-slate-500">Check every request before resubmitting.</p></div><Button size="icon" variant="ghost" className="size-9" title="Close" disabled={isPending} onClick={() => setConfirmationOpen(false)}><X className="size-5" aria-hidden /></Button></div><div className="space-y-4 p-5"><RequestedChanges items={feedback} compact /><label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-slate-50 p-4"><input type="checkbox" className="mt-0.5 size-4 accent-teal-600" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><span className="block text-sm font-medium text-slate-900">I confirm that I completed all requested changes.</span><span className="mt-0.5 block text-xs text-slate-500">A new version will be created and returned for review.</span></span></label>{message ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{message}</p> : null}</div><div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end"><Button variant="secondary" disabled={isPending} onClick={() => setConfirmationOpen(false)}>Continue editing</Button><Button disabled={isPending || !confirmed} onClick={submit}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}Confirm and resubmit</Button></div></section></div> : null}
    </section>
  );
}
