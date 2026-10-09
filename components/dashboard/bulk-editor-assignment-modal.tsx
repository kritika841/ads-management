"use client";

import { useMemo, useState } from "react";
import { Loader2, UserCheck, UserMinus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { ProductionStageBadge } from "@/components/workflow/production-stage";
import { planEditorAssignment, summarizeEditorAssignmentPlans, type EditorAssignmentKind, type EditorAssignmentMode } from "@/lib/editor-assignment";
import type { AdWithRelations, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

export type BulkEditorAssignmentRequest = {
  mode: EditorAssignmentMode;
  editorId: string;
  deadline: string;
  reason: string;
};

const kindLabel: Record<EditorAssignmentKind, string> = {
  assign: "Assign",
  reassign: "Reassign",
  unassign: "Unassign",
  skip: "Skipped"
};

const kindTone: Record<EditorAssignmentKind, string> = {
  assign: "border-primary/30 bg-primary/10 text-primary",
  reassign: "border-warning/30 bg-warning/10 text-warning",
  unassign: "border-destructive/30 bg-destructive/10 text-destructive",
  skip: "border-border bg-muted text-muted-foreground"
};

/**
 * Bulk editor assignment for managers/admins: assign or reassign the selected creatives to one
 * editor, or remove their editor. Shows exactly what will happen to each creative before saving.
 */
export function BulkEditorAssignmentModal({
  selectedAds,
  editors,
  editorWorkloads,
  profile,
  pending,
  onClose,
  onSubmit
}: {
  selectedAds: AdWithRelations[];
  editors: Profile[];
  editorWorkloads: Record<string, number>;
  profile: Profile;
  pending: boolean;
  onClose: () => void;
  onSubmit: (request: BulkEditorAssignmentRequest) => void;
}) {
  const [mode, setMode] = useState<EditorAssignmentMode>("assign");
  const [editorId, setEditorId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [reason, setReason] = useState("");
  const activeEditors = useMemo(() => editors.filter((item) => item.active && item.role === "editor"), [editors]);

  const plans = useMemo(
    () => selectedAds.map((ad) => ({ ad, plan: planEditorAssignment(ad, mode, { editorId, deadline }) })),
    [deadline, editorId, mode, selectedAds]
  );
  const summary = summarizeEditorAssignmentPlans(plans.map((item) => item.plan));
  const actionable = summary.assign + summary.reassign + summary.unassign;
  const needsReason = mode === "assign" && summary.reassign > 0;

  return (
    <Modal open labelledBy="bulk-editor-title" onClose={() => { if (!pending) onClose(); }} className="flex items-center justify-center p-4">
      <section className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-float dark:shadow-none">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="bulk-editor-title" className="text-lg font-semibold text-foreground">Editor assignment · {selectedAds.length} creative{selectedAds.length === 1 ? "" : "s"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Assign, reassign or remove the editor. Creatives that can&apos;t take the change are skipped.</p>
          </div>
          <Button size="icon" variant="ghost" className="size-9" title="Close" disabled={pending} onClick={onClose}><X className="size-5" aria-hidden /></Button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="inline-flex rounded-lg border border-border bg-muted p-1" role="tablist" aria-label="Assignment action">
            {([
              { key: "assign", label: "Assign / reassign", icon: UserCheck },
              { key: "unassign", label: "Unassign editor", icon: UserMinus }
            ] as const).map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={mode === option.key}
                onClick={() => setMode(option.key)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition",
                  mode === option.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <option.icon className="size-3.5" aria-hidden />
                {option.label}
              </button>
            ))}
          </div>

          {mode === "assign" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Editor">
                <Select id="bulk-editor-select" value={editorId} onChange={(event) => setEditorId(event.target.value)}>
                  <option value="">Choose editor</option>
                  {activeEditors.map((editor) => (
                    <option key={editor.id} value={editor.id}>{editor.name} · {editorWorkloads[editor.id] ?? 0} assigned</option>
                  ))}
                </Select>
              </Field>
              <Field label="Deadline" hint="Leave empty to keep each creative's current deadline.">
                <Input id="bulk-editor-deadline" type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
              </Field>
            </div>
          ) : null}

          {mode === "unassign" || needsReason ? (
            <Field label={mode === "unassign" ? "Reason (optional)" : "Reassignment reason (optional)"} hint="Saved in the activity log.">
              <Textarea
                id="bulk-editor-reason"
                className="min-h-20"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={mode === "unassign" ? `Editor removed by ${profile.name}` : `Bulk reassignment by ${profile.name}`}
              />
            </Field>
          ) : null}

          <div className="flex flex-wrap gap-2 text-xs">
            {(["assign", "reassign", "unassign", "skip"] as const).filter((kind) => summary[kind] > 0).map((kind) => (
              <span key={kind} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium", kindTone[kind])}>
                {summary[kind]} {kindLabel[kind].toLowerCase()}
              </span>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">Creative</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Current editor</th><th className="px-3 py-2">Result</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {plans.map(({ ad, plan }) => (
                  <tr key={ad.id}>
                    <td className="max-w-[180px] truncate px-3 py-2 font-medium text-foreground" title={ad.name}>{ad.name}</td>
                    <td className="px-3 py-2"><ProductionStageBadge stage={ad.production_stage} role={profile.role} className="bg-muted text-muted-foreground shadow-none" /></td>
                    <td className="px-3 py-2 text-muted-foreground">{ad.editor?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", kindTone[plan.kind])}>{kindLabel[plan.kind]}</span>
                      {plan.reason ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{plan.reason}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" disabled={pending} onClick={onClose}>Cancel</Button>
          <Button
            id="bulk-editor-submit"
            variant={mode === "unassign" ? "danger" : "primary"}
            disabled={pending || actionable === 0}
            onClick={() => onSubmit({ mode, editorId, deadline, reason: reason.trim() })}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : mode === "unassign" ? <UserMinus className="size-4" aria-hidden /> : <UserCheck className="size-4" aria-hidden />}
            {mode === "unassign" ? `Unassign ${actionable || ""}` : `Apply to ${actionable || ""}`}
          </Button>
        </div>
      </section>
    </Modal>
  );
}
