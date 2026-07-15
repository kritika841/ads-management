"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send } from "lucide-react";
import { creatorReviewAd } from "@/app/actions/ads";
import { runServerAction } from "@/lib/client-action";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export function CreatorReviewActions({ adId }: { adId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [approvalQueued, setApprovalQueued] = useState(false);
  const [isPending, startTransition] = useTransition();

  function decide(decision: "approve" | "request_changes") {
    if (decision === "approve") {
      setApprovalQueued(true);
      toast({ title: "Approved for final review", description: "This will be sent in 5 seconds.", tone: "success", duration: 5_000, action: { label: "Undo", onClick: () => setApprovalQueued(false) }, onExpire: () => saveDecision(decision) });
      return;
    }
    void saveDecision(decision);
  }

  function saveDecision(decision: "approve" | "request_changes") {
    startTransition(async () => {
      const response = await runServerAction(() => creatorReviewAd(adId, decision, note));
      setApprovalQueued(false);
      toast({ title: response.ok ? (decision === "approve" ? "Sent for final approval" : "Changes requested") : "Review not saved", description: response.ok ? (decision === "approve" ? "A manager or admin can now give final approval." : "The creative was returned to the editor.") : response.message ?? "Unable to save review.", tone: response.ok ? "success" : "error" });
      if (response.ok) { setNote(""); router.refresh(); }
    });
  }

  return <section className="panel p-5"><h2 className="section-heading">Your review</h2><p className="mt-1 text-sm text-muted-foreground">Approve the edit for final review, or send specific changes to the editor.</p><div className="mt-4"><Field label="Review note"><Textarea className="min-h-24" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional for approval; required for changes" /></Field></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><Button disabled={isPending || approvalQueued} onClick={() => decide("approve")}>{isPending || approvalQueued ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}Approve edit</Button><Button variant="secondary" disabled={isPending || approvalQueued || !note.trim()} onClick={() => decide("request_changes")}><Send className="size-4" aria-hidden />Request changes</Button></div></section>;
}
