"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, X } from "lucide-react";
import { reassignEditor } from "@/app/actions/ads";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { AdWithRelations, Profile } from "@/lib/types";

export function ReassignEditorButton({ ad, editors, workloads }: { ad: AdWithRelations; editors: Profile[]; workloads: Record<string, number> }) {
  const router = useRouter();
  const options = editors.filter((item) => item.active && item.role === "editor" && item.id !== ad.editor_id);
  const [open, setOpen] = useState(false);
  const [editorId, setEditorId] = useState(options[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [deadline, setDeadline] = useState(ad.deadline ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const response = await reassignEditor({ adId: ad.id, editorId, deadline, reason });
      if (!response.ok) { setMessage(response.message ?? "Unable to reassign editor."); return; }
      setOpen(false); router.refresh();
    });
  }

  return <><Button size="sm" variant="secondary" disabled={!options.length} onClick={() => setOpen(true)}><RefreshCw className="size-4" aria-hidden />Reassign editor</Button>{open ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="reassign-editor-title"><section className="w-full max-w-md rounded-xl border border-border bg-card shadow-float dark:shadow-none"><div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4"><div><h2 id="reassign-editor-title" className="text-lg font-semibold text-foreground">Reassign editor</h2><p className="mt-1 text-sm text-muted-foreground">The current editor will immediately lose access.</p></div><Button size="icon" variant="ghost" className="size-9" title="Close" onClick={() => setOpen(false)}><X className="size-5" aria-hidden /></Button></div><div className="space-y-4 p-5"><Field label="New editor"><Select value={editorId} onChange={(event) => setEditorId(event.target.value)}>{options.map((editor) => <option key={editor.id} value={editor.id}>{editor.name} · {workloads[editor.id] ?? 0} assigned</option>)}</Select></Field><Field label="Deadline" hint="Required."><Input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} required /></Field><Field label="Reason"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this assignment changing?" /></Field>{message ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p> : null}</div><div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={isPending || !editorId || !deadline || !reason.trim()} onClick={submit}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}Reassign</Button></div></section></div> : null}</>;
}
