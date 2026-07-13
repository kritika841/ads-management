"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, CircleCheck, Clock3, Loader2, MessageSquareText, RotateCcw, Send, XCircle } from "lucide-react";
import { addAnnotation, resolveAnnotation, reviewAd } from "@/app/actions/ads";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { AdWithRelations, Annotation, Profile, ReviewAction } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function ReviewPanel({
  ad,
  profile,
  reviews,
  annotations
}: {
  ad: AdWithRelations;
  profile: Profile;
  reviews: ReviewAction[];
  annotations: Annotation[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isReviewer = profile.role === "admin" || profile.role === "manager";
  const isAdmin = profile.role === "admin";
  const canReviewNow = isReviewer && ad.status === "pending_review" && (ad.production_stage === "creator_review" || ad.production_stage === "final_review");
  const canReopenApproved = isAdmin && ad.production_stage === "approved";
  const permissionMessage = isReviewer && !canReviewNow && !canReopenApproved
    ? ad.production_stage === "approved"
      ? "Final approval is complete."
      : "Final approval becomes available after the editor submits the video."
    : null;

  function decide(decision: "approve" | "request_changes") {
    setMessage(null);
    startTransition(async () => {
      const response = await reviewAd(ad.id, decision, note);
      setMessage(response.ok ? "Review saved." : response.message ?? "Unable to review.");
      if (response.ok) {
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="section-heading">Final approval</h2>{canReviewNow ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700"><span className="size-1.5 rounded-full bg-amber-500" />Action required</span> : null}</div>

      {isReviewer ? (
        <div className="mt-4 space-y-4">
          {permissionMessage ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{permissionMessage}</p>
          ) : null}
          {canReviewNow && ad.production_stage === "creator_review" ? <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">The content creator has not approved yet. You can still provide direct final approval.</p> : null}
          {canReviewNow ? <Field label="Review note">
            <Textarea
              className="min-h-24"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Approval note or specific requested changes"
            />
          </Field> : null}
          <div className="grid gap-2">
            <Button disabled={isPending || !canReviewNow} onClick={() => decide("approve")}>
              {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
              Final approve
            </Button>
            <Button
              variant="secondary"
              disabled={isPending || !canReviewNow || !note.trim()}
              onClick={() => decide("request_changes")}
            >
              <Send className="size-4" aria-hidden />
              Request Changes
            </Button>
          </div>

          {canReopenApproved ? (
            <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/60 p-4">
              <p className="text-sm text-amber-800">This ad is already approved. As an admin, you can reopen it and send it back for changes.</p>
              <Field label="What needs to change?">
                <Textarea
                  className="min-h-24"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Describe the required changes"
                />
              </Field>
              <Button
                variant="secondary"
                disabled={isPending || !note.trim()}
                onClick={() => decide("request_changes")}
              >
                {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                Reopen and request changes
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Review actions are available to managers and admins.</p>
      )}

      {message ? <p className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{message}</p> : null}

      <ReviewNotes adId={ad.id} annotations={annotations} />

      {reviews.length ? <div className="mt-5 border-t border-border pt-4"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold text-slate-500">Review history</p><span className="text-xs text-slate-400">{reviews.length}</span></div><div className="space-y-3">
        {reviews.map((review) => (
          <div key={review.id} className="flex gap-3">
            <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${review.decision === "approve" ? "bg-emerald-50 text-emerald-700" : review.decision === "reject" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{review.decision === "approve" ? <CircleCheck className="size-3.5" aria-hidden /> : review.decision === "reject" ? <XCircle className="size-3.5" aria-hidden /> : <MessageSquareText className="size-3.5" aria-hidden />}</span>
            <div className="min-w-0 flex-1 border-b border-border pb-3 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium capitalize text-slate-950">{review.decision.replace("_", " ")}</p>
              <span className="text-xs text-slate-500">{formatDateTime(review.created_at)}</span>
            </div>
            {review.reviewer?.name ? <p className="mt-0.5 text-xs text-slate-400">by {review.reviewer.name}</p> : null}
            {review.note ? <p className="mt-2 text-sm leading-5 text-slate-600">{review.note}</p> : null}
            </div>
          </div>
        ))}
      </div></div> : null}
    </section>
  );
}

function ReviewNotes({ adId, annotations }: { adId: string; annotations: Annotation[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"video_timestamp" | "script_inline">("video_timestamp");
  const [seconds, setSeconds] = useState("");
  const [anchor, setAnchor] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addNote() {
    setMessage(null);
    startTransition(async () => {
      const result = await addAnnotation({
        adId,
        kind,
        body,
        timestampSeconds: kind === "video_timestamp" && seconds !== "" ? Number(seconds) : null,
        scriptAnchor: kind === "script_inline" ? anchor : null
      });
      if (!result.ok) return setMessage(result.message ?? "Unable to add review note.");
      setBody("");
      setSeconds("");
      setAnchor("");
      router.refresh();
    });
  }

  function toggleResolved(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await resolveAnnotation(id);
      if (!result.ok) return setMessage(result.message ?? "Unable to update review note.");
      router.refresh();
    });
  }

  return (
    <details className="mt-5 border-t border-border pt-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-800">
        <span className="inline-flex items-center gap-2"><MessageSquareText className="size-4 text-slate-500" aria-hidden />Review notes</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{annotations.filter((item) => !item.resolved_at).length} open</span>
      </summary>
      <div className="mt-4 space-y-4">
        <div className="space-y-2 rounded-md bg-slate-50 p-3">
          <Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Review note type">
            <option value="video_timestamp">Video timestamp</option>
            <option value="script_inline">Script note</option>
          </Select>
          {kind === "video_timestamp" ? <Input type="number" min="0" step="1" value={seconds} onChange={(event) => setSeconds(event.target.value)} placeholder="Time in seconds, for example 14" /> : <Input value={anchor} onChange={(event) => setAnchor(event.target.value)} placeholder="Script section or quoted words" />}
          <Textarea className="min-h-20" value={body} onChange={(event) => setBody(event.target.value)} placeholder="What needs attention?" />
          <Button className="w-full" size="sm" disabled={pending || !body.trim()} onClick={addNote}>{pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}Add note</Button>
        </div>
        {message ? <p className="text-sm text-rose-600" role="alert">{message}</p> : null}
        {annotations.length ? <div className="space-y-2">{annotations.map((annotation) => (
          <div key={annotation.id} className={`rounded-md border p-3 ${annotation.resolved_at ? "border-slate-200 bg-slate-50 opacity-70" : "border-amber-200 bg-amber-50/50"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">{annotation.kind === "video_timestamp" ? <><Clock3 className="size-3.5" aria-hidden />{annotation.timestamp_seconds ?? 0}s</> : annotation.script_anchor || "Script note"}</p><p className="mt-1 text-sm text-slate-700">{annotation.body}</p></div>
              <Button size="icon" variant="ghost" className="size-7 shrink-0" title={annotation.resolved_at ? "Reopen note" : "Mark note resolved"} disabled={pending} onClick={() => toggleResolved(annotation.id)}>{annotation.resolved_at ? <RotateCcw className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}</Button>
            </div>
          </div>
        ))}</div> : <p className="text-sm text-slate-500">No review notes yet.</p>}
      </div>
    </details>
  );
}
