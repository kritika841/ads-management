"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send } from "lucide-react";
import { creatorReviewAd } from "@/app/actions/ads";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";

export function CreatorReviewActions({ adId }: { adId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function decide(decision: "approve" | "request_changes") {
    setMessage(null);
    startTransition(async () => {
      const response = await creatorReviewAd(adId, decision, note);
      setMessage(response.ok ? decision === "approve" ? "Sent for final approval." : "Changes sent to the editor." : response.message ?? "Unable to save review.");
      if (response.ok) { setNote(""); router.refresh(); }
    });
  }

  return <section className="panel p-5"><h2 className="section-heading">Your review</h2><p className="mt-1 text-sm text-slate-500">Approve the edit for final review, or send specific changes to the editor.</p><div className="mt-4"><Field label="Review note"><Textarea className="min-h-24" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional for approval; required for changes" /></Field></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><Button disabled={isPending} onClick={() => decide("approve")}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}Approve edit</Button><Button variant="secondary" disabled={isPending || !note.trim()} onClick={() => decide("request_changes")}><Send className="size-4" aria-hidden />Request changes</Button></div>{message ? <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{message}</p> : null}</section>;
}
