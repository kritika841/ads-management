"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, CircleCheck, Clock3, Loader2, MessageSquareText, RotateCcw, Send, XCircle } from "lucide-react";
import { addAnnotation, resolveAnnotation, reviewAd } from "@/app/actions/ads";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatVideoTime, useVideoTimestamp } from "@/components/review/video-timestamp-context";
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
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [approvalQueued, setApprovalQueued] = useState(false);
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
    if (decision === "approve") {
      setApprovalQueued(true);
      toast({
        title: "Approved",
        description: "Final approval will be saved in 5 seconds.",
        tone: "success",
        duration: 5_000,
        action: { label: "Undo", onClick: () => setApprovalQueued(false) },
        onExpire: () => saveDecision(decision)
      });
      return;
    }
    void saveDecision(decision);
  }

  function saveDecision(decision: "approve" | "request_changes") {
    startTransition(async () => {
      const response = await reviewAd(ad.id, decision, note);
      setApprovalQueued(false);
      toast({ title: response.ok ? (decision === "approve" ? "Creative approved" : "Changes requested") : "Review not saved", description: response.ok ? (decision === "approve" ? "Final approval is complete." : "The creative was returned to the editor.") : response.message ?? "Unable to review.", tone: response.ok ? "success" : "error" });
      if (response.ok) {
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="section-heading">Final approval</h2>{canReviewNow ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning"><span className="size-1.5 rounded-full bg-warning" />Action required</span> : null}</div>

      {isReviewer ? (
        <div className="mt-4 space-y-4">
          {permissionMessage ? (
            <p className="rounded-md bg-warning/15 px-3 py-2 text-sm text-warning">{permissionMessage}</p>
          ) : null}
          {canReviewNow && ad.production_stage === "creator_review" ? <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">The content creator has not approved yet. You can still provide direct final approval.</p> : null}
          {canReviewNow ? <Field label="Review note">
            <Textarea
              className="min-h-24"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Approval note or specific requested changes"
            />
          </Field> : null}
          <div className="grid gap-2">
            <Button disabled={isPending || approvalQueued || !canReviewNow} onClick={() => decide("approve")}>
              {isPending || approvalQueued ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
              Final approve
            </Button>
            <Button
              variant="secondary"
              disabled={isPending || approvalQueued || !canReviewNow || !note.trim()}
              onClick={() => decide("request_changes")}
            >
              <Send className="size-4" aria-hidden />
              Request Changes
            </Button>
          </div>

          {canReopenApproved ? (
            <div className="space-y-3 rounded-md border border-warning/30 bg-warning/15/60 p-4">
              <p className="text-sm text-warning">This ad is already approved. As an admin, you can reopen it and send it back for changes.</p>
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
        <p className="mt-3 text-sm text-muted-foreground">Review actions are available to managers and admins.</p>
      )}

      <ReviewNotes adId={ad.id} annotations={annotations} />

      {reviews.length ? <div className="mt-5 border-t border-border pt-4"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold text-muted-foreground">Review history</p><span className="text-xs text-muted-foreground">{reviews.length}</span></div><div className="space-y-3">
        {reviews.map((review) => (
          <div key={review.id} className="flex gap-3">
            <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${review.decision === "approve" ? "bg-success/15 text-success" : review.decision === "reject" ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning"}`}>{review.decision === "approve" ? <CircleCheck className="size-3.5" aria-hidden /> : review.decision === "reject" ? <XCircle className="size-3.5" aria-hidden /> : <MessageSquareText className="size-3.5" aria-hidden />}</span>
            <div className="min-w-0 flex-1 border-b border-border pb-3 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium capitalize text-foreground">{review.decision.replace("_", " ")}</p>
              <span className="text-xs text-muted-foreground">{formatDateTime(review.created_at)}</span>
            </div>
            {review.reviewer?.name ? <p className="mt-0.5 text-xs text-muted-foreground">by {review.reviewer.name}</p> : null}
            {review.note ? <p className="mt-2 text-sm leading-5 text-muted-foreground">{review.note}</p> : null}
            </div>
          </div>
        ))}
      </div></div> : null}
    </section>
  );
}

function ReviewNotes({ adId, annotations }: { adId: string; annotations: Annotation[] }) {
  const router = useRouter();
  const { currentTime, hasVideo, seekTo } = useVideoTimestamp();
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
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
        <span className="inline-flex items-center gap-2"><MessageSquareText className="size-4 text-muted-foreground" aria-hidden />Review notes</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{annotations.filter((item) => !item.resolved_at).length} open</span>
      </summary>
      <div className="mt-4 space-y-4">
        <div className="space-y-2 rounded-md bg-muted p-3">
          <Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Review note type">
            <option value="video_timestamp">Video timestamp</option>
            <option value="script_inline">Script note</option>
          </Select>
          {kind === "video_timestamp" ? <div className="flex flex-col gap-2 sm:flex-row"><Input type="number" min="0" step="1" value={seconds} onChange={(event) => setSeconds(event.target.value)} placeholder="Time in seconds, for example 14" /><Button className="sm:w-auto" variant="secondary" disabled={!hasVideo} onClick={() => { const time = currentTime(); if (time !== null) setSeconds(String(Math.floor(time))); }}>Use current time</Button></div> : <Input value={anchor} onChange={(event) => setAnchor(event.target.value)} placeholder="Script section or quoted words" />}
          {kind === "video_timestamp" && !hasVideo ? <p className="text-xs text-muted-foreground">Play the video above to capture its current time, or enter seconds manually.</p> : null}
          <Textarea className="min-h-20" value={body} onChange={(event) => setBody(event.target.value)} placeholder="What needs attention?" />
          <Button className="w-full" size="sm" disabled={pending || !body.trim()} onClick={addNote}>{pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}Add note</Button>
        </div>
        {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
        {annotations.length ? <div className="space-y-2">{annotations.map((annotation) => (
          <div key={annotation.id} className={`rounded-md border p-3 ${annotation.resolved_at ? "border-border bg-muted opacity-70" : "border-warning/30 bg-warning/15/50"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">{annotation.kind === "video_timestamp" ? <button type="button" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-xs font-semibold text-primary hover:border-ring/50 hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground" disabled={!hasVideo} title={hasVideo ? "Play video from this time" : "Video preview unavailable"} onClick={() => seekTo(annotation.timestamp_seconds ?? 0)}><Clock3 className="size-3.5" aria-hidden />{formatVideoTime(annotation.timestamp_seconds ?? 0)}</button> : <p className="text-xs font-semibold text-muted-foreground">{annotation.script_anchor || "Script note"}</p>}<p className="mt-1 text-sm text-muted-foreground">{annotation.body}</p></div>
              <Button size="icon" variant="ghost" className="size-7 shrink-0" title={annotation.resolved_at ? "Reopen note" : "Mark note resolved"} disabled={pending} onClick={() => toggleResolved(annotation.id)}>{annotation.resolved_at ? <RotateCcw className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}</Button>
            </div>
          </div>
        ))}</div> : <p className="text-sm text-muted-foreground">No review notes yet.</p>}
      </div>
    </details>
  );
}
