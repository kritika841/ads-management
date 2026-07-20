"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Link2, Loader2, UploadCloud } from "lucide-react";
import { submitFinalClipByReviewer } from "@/app/actions/ads";
import { runServerAction } from "@/lib/client-action";
import { RichTextEditor } from "@/components/dashboard/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { parseGoogleDriveVideoFileUrl } from "@/lib/drive-urls";
import type { AdWithRelations, Profile } from "@/lib/types";

export function ManagerFinalUpload({
  ad,
  profile
}: {
  ad: AdWithRelations;
  profile: Profile;
}) {
  const router = useRouter();
  const [driveUrl, setDriveUrl] = useState("");
  const [driveUrlError, setDriveUrlError] = useState<string | null>(null);
  const [rawFootageUrl, setRawFootageUrl] = useState(ad.raw_footage_url ?? "");
  const [scriptHtml, setScriptHtml] = useState(ad.script_html ?? "");
  const [scriptText, setScriptText] = useState(ad.script_text ?? "");
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
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

  const canSubmit = Boolean(driveUrl.trim() && !driveUrlError && !isPending);

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() =>
        submitFinalClipByReviewer({
          adId: ad.id,
          driveUrl,
          rawFootageUrl: rawFootageUrl || undefined,
          scriptHtml: scriptHtml || undefined,
          scriptText: scriptText || undefined,
          reviewerNotes: reviewerNotes || undefined
        })
      );
      if (!response.ok) {
        setMessage(response.message ?? "Unable to upload the final clip.");
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  }

  if (success) {
    return (
      <section className="panel overflow-hidden border-2 border-green-500/40 bg-green-500/5">
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <CheckCircle2 className="size-10 text-green-500" aria-hidden />
          <p className="font-semibold text-foreground">Final clip uploaded &amp; approved</p>
          <p className="text-sm text-muted-foreground">The ad has been marked as approved with the final video.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-xl border-2 border-primary/40 bg-accent/30"
      id="manager-final-upload"
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-primary/20 bg-primary/10 px-5 py-4">
        <UploadCloud className="size-5 shrink-0 text-primary" aria-hidden />
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Upload final clip
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground uppercase tracking-wide">
              {profile.role === "admin" ? "Admin" : "Manager"}
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Upload the finished video directly and mark this ad as approved — no editor assignment needed.
          </p>
        </div>
      </div>

      {/* Form body — always visible */}
      <div className="space-y-5 p-5">
        {/* Final video URL — required */}
        <Field
          label="Final edited video"
          hint="Required · Paste a single Google Drive video file link (not a folder link, not any other website)."
        >
          <div className="relative">
            <Link2
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="manager-final-drive-url"
              className="pl-9"
              value={driveUrl}
              onChange={(event) => handleDriveUrlChange(event.target.value)}
              placeholder="https://drive.google.com/file/d/…/view"
              aria-invalid={Boolean(driveUrlError)}
              aria-describedby={driveUrlError ? "drive-url-error" : undefined}
            />
          </div>
          {driveUrlError ? (
            <p id="drive-url-error" className="mt-1.5 text-xs text-destructive" role="alert">
              {driveUrlError}
            </p>
          ) : null}
        </Field>

        {/* Raw footage — optional, pre-filled if already set */}
        <Field
          label="Raw footage folder"
          hint={ad.raw_footage_url ? "Already set — update only if needed." : "Optional · Google Drive folder link."}
        >
          <div className="relative">
            <Link2
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-9"
              value={rawFootageUrl}
              onChange={(event) => setRawFootageUrl(event.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
            />
          </div>
        </Field>

        {/* Script — optional, pre-filled if already set */}
        <Field
          label="Script / copy"
          hint={ad.script_text ? "Already set — update only if needed." : "Optional."}
        >
          <RichTextEditor
            value={scriptHtml}
            onChange={(html, text) => {
              setScriptHtml(html);
              setScriptText(text);
            }}
          />
        </Field>

        {/* Reviewer notes */}
        <Field label="Notes" hint="Optional — visible to the creator and editor.">
          <Textarea
            className="min-h-20"
            value={reviewerNotes}
            onChange={(event) => setReviewerNotes(event.target.value)}
            placeholder="Any context for the team…"
          />
        </Field>

        {message ? (
          <p
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {message}
          </p>
        ) : null}

        <div className="flex justify-end border-t border-border pt-5">
          <Button id="manager-upload-approve-btn" disabled={!canSubmit} onClick={submit}>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <UploadCloud className="size-4" aria-hidden />
            )}
            Upload &amp; approve
          </Button>
        </div>
      </div>
    </section>
  );
}
