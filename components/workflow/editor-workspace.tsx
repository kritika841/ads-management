"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Layers, Link2, Loader2, LockOpen, Play, Send, Snowflake, X } from "lucide-react";
import { startEditing, submitEditedVideo } from "@/app/actions/ads";
import { runServerAction } from "@/lib/client-action";
import { RequestedChanges } from "@/components/review/requested-changes";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { parseGoogleDriveVideoFileUrl } from "@/lib/drive-urls";
import { EditorTimer } from "@/components/workflow/editor-timer";
import type { ResubmissionFeedbackItem } from "@/lib/resubmission";
import type { AdWithRelations, EditorTimeLog } from "@/lib/types";
import { formatDateOnly } from "@/lib/utils";

type EditedVariationDraft = {
  id: string;
  label: string;
  driveUrl: string;
};

export function EditorWorkspace({ ad, feedback, inProgressCount, maxConcurrentEdits, timeLogs }: { ad: AdWithRelations; feedback: ResubmissionFeedbackItem[]; inProgressCount: number; maxConcurrentEdits: number; timeLogs: EditorTimeLog[] }) {
  const frozen = ad.editing_freeze === "frozen";
  const unfrozen = ad.editing_freeze === "unfrozen";
  // A manager/admin "unfrozen" override beats the per-editor concurrent-edit limit.
  const atCapacity = !unfrozen && inProgressCount >= maxConcurrentEdits;
  const router = useRouter();
  const resubmitting = ad.production_stage === "changes_requested";
  const creatorVariations = ad.variations ?? [];
  const [driveUrl, setDriveUrl] = useState(resubmitting ? ad.drive_url ?? "" : "");
  const [driveUrlError, setDriveUrlError] = useState<string | null>(null);
  const [variationVideos, setVariationVideos] = useState<EditedVariationDraft[]>(() =>
    creatorVariations.map((cv, idx) => {
      const prev = (ad.edited_variations ?? []).find((ev) => ev.id === cv.id) ?? ad.edited_variations?.[idx];
      return {
        id: cv.id || `var-${idx + 1}`,
        label: cv.label || `Variation ${idx + 1}`,
        driveUrl: resubmitting && prev ? prev.drive_url || "" : ""
      };
    })
  );
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

  function updateVariationUrl(index: number, driveUrlValue: string) {
    setVariationVideos((current) =>
      current.map((item, idx) => (idx === index ? { ...item, driveUrl: driveUrlValue } : item))
    );
  }

  const variationVideosValid = variationVideos.every((item) => {
    const trimmed = item.driveUrl.trim();
    if (!trimmed) return false;
    return !parseGoogleDriveVideoFileUrl(trimmed).error;
  });

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
      const response = await runServerAction(() => submitEditedVideo({
        adId: ad.id,
        driveUrl,
        variationVideos,
        editorNotes,
        changesConfirmed: confirmed
      }));
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
      {frozen ? (
        <div className="flex items-start gap-3 border-b border-primary/30 bg-primary/10 px-5 py-3 text-sm text-foreground" role="status">
          <Snowflake className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p><span className="font-semibold">Editing is frozen by a manager.</span> You can&apos;t start, resume or submit this creative until it is unfrozen. You&apos;ll be notified when that happens.</p>
        </div>
      ) : unfrozen ? (
        <div className="flex items-start gap-3 border-b border-success/30 bg-success/10 px-5 py-3 text-sm text-success" role="status">
          <LockOpen className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p><span className="font-semibold">Unfrozen by a manager.</span> This creative doesn&apos;t count toward your active editing limit.</p>
        </div>
      ) : null}
      <div className="border-b border-border p-5"><h2 className="section-heading">Editing task</h2><p className="mt-1 text-sm text-muted-foreground">The script and raw footage are read-only. Submit only when the final video is ready.</p></div>
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Script</p>
          <div
            className="prose prose-sm mt-2 max-h-80 max-w-none overflow-y-auto rounded-md border border-border bg-muted p-4"
            dangerouslySetInnerHTML={{
              __html:
                ad.script_html ||
                (ad.script_text
                  ? `<p>${ad.script_text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`
                  : "<p>No script provided.</p>")
            }}
          />
        </div>
        <div className="space-y-4">
          <div><p className="text-xs font-semibold uppercase text-muted-foreground">Raw footage</p>{ad.production_stage === "ready_for_edit" ? <p className="mt-2 text-sm text-muted-foreground">The raw footage link unlocks once you start editing.</p> : ad.raw_footage_url ? <a href={ad.raw_footage_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">Open Drive folder <ExternalLink className="size-4" aria-hidden /></a> : <p className="mt-2 text-sm text-destructive">Raw footage link is missing.</p>}</div>
          {ad.production_stage !== "ready_for_edit" && ad.variations && ad.variations.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Variations ({ad.variations.length})</p>
              <ul className="mt-2 space-y-1.5">
                {ad.variations.map((variation, idx) => (
                  <li key={variation.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-foreground">{variation.label || `Variation ${idx + 1}`}</span>
                    {variation.raw_footage_url ? (
                      <a href={variation.raw_footage_url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
                        Open folder <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">Pending link</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <dl className="grid gap-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Creator</dt><dd className="font-medium text-foreground">{ad.creator?.name ?? "Unassigned"}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Campaign</dt><dd className="font-medium text-foreground">{ad.campaigns?.map((item) => item.name).join(", ") || ad.campaign?.name || "No campaign"}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Deadline</dt><dd className={ad.deadline ? "font-medium text-foreground" : "text-muted-foreground"}>{ad.deadline ? formatDateOnly(ad.deadline) : "No deadline set"}</dd></div></dl>
        </div>
      </div>

      {ad.production_stage === "ready_for_edit" ? (
        <div className="border-t border-border bg-muted px-5 py-4">
          <p className="mb-3 text-sm text-muted-foreground">{unfrozen ? "This creative was unfrozen by a manager, so your active editing limit doesn't apply." : `You have ${inProgressCount} of ${maxConcurrentEdits} videos in progress. ${atCapacity ? "Submit one before starting another." : ""}`}</p>
          <Button disabled={isPending || !ad.raw_footage_url || atCapacity || frozen} onClick={begin}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}Start editing</Button>
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
        </Field><Field label="Editing note" hint="Optional"><Textarea className="min-h-20" value={editorNotes} onChange={(event) => setEditorNotes(event.target.value)} placeholder="What changed or what should reviewers know?" /></Field></div>

        {variationVideos.length > 0 ? (
          <div className="mt-5 rounded-xl border border-border bg-muted/30 p-4">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Layers className="size-4 text-primary" aria-hidden />
                Variation videos ({variationVideos.length})
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Submit the edited Google Drive video file link for each creator variation below.
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {variationVideos.map((item, idx) => {
                const trimmed = item.driveUrl.trim();
                const urlError = trimmed ? parseGoogleDriveVideoFileUrl(trimmed).error : null;

                return (
                  <div
                    key={item.id}
                    className="grid gap-3 rounded-lg border border-border bg-card p-3 md:grid-cols-[180px_minmax(0,1fr)] md:items-start"
                  >
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Variation</p>
                      <p className="mt-1.5 text-sm font-semibold text-foreground">{item.label}</p>
                    </div>
                    <Field
                      label="Edited video (Drive link)"
                      hint="Required · Must be a single Google Drive video file link."
                    >
                      <div className="relative">
                        <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        <Input
                          className="pl-9"
                          value={item.driveUrl}
                          onChange={(event) => updateVariationUrl(idx, event.target.value)}
                          placeholder="https://drive.google.com/file/d/..."
                          aria-invalid={Boolean(urlError)}
                        />
                      </div>
                      {urlError ? (
                        <p className="mt-1 text-xs text-destructive" role="alert">{urlError}</p>
                      ) : !trimmed ? (
                        <p className="mt-1 text-xs text-warning">Paste the Google Drive video file link for {item.label}.</p>
                      ) : null}
                    </Field>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end"><Button disabled={isPending || frozen || !driveUrl.trim() || Boolean(driveUrlError) || !variationVideosValid} onClick={() => resubmitting ? setConfirmationOpen(true) : submit()}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}{resubmitting ? "Resubmit edited video" : "Submit edited video"}</Button></div></div> : null}

      {/* Live editing timer — shown whenever the editor is actively in editing or changes_requested */}
      {(ad.production_stage === "editing" || resubmitting) ? (
        <EditorTimer adId={ad.id} timeLogs={timeLogs} />
      ) : null}

      {message ? <p className="mx-5 mb-5 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground" role="status">{message}</p> : null}

      {confirmationOpen ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="editor-resubmit-title"><section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card shadow-float dark:shadow-none"><div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4"><div><h2 id="editor-resubmit-title" className="text-lg font-semibold text-foreground">Confirm requested changes</h2><p className="mt-1 text-sm text-muted-foreground">Check every request before resubmitting.</p></div><Button size="icon" variant="ghost" className="size-9" title="Close" disabled={isPending} onClick={() => setConfirmationOpen(false)}><X className="size-5" aria-hidden /></Button></div><div className="space-y-4 p-5"><RequestedChanges items={feedback} compact /><label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted p-4"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><span className="block text-sm font-medium text-foreground">I confirm that I completed all requested changes.</span><span className="mt-0.5 block text-xs text-muted-foreground">A new version will be created and returned for review.</span></span></label>{message ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{message}</p> : null}</div><div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end"><Button variant="secondary" disabled={isPending} onClick={() => setConfirmationOpen(false)}>Continue editing</Button><Button disabled={isPending || !confirmed} onClick={submit}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}Confirm and resubmit</Button></div></section></div> : null}
    </section>
  );
}
