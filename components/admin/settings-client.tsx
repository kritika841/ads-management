"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, Pencil, Plus, Power, RotateCcw, Trash2 } from "lucide-react";
import { deleteCampaign, saveCampaign, updateSettings } from "@/app/actions/admin";
import { runServerAction } from "@/lib/client-action";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { AppSettings, AuditLog, Campaign } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function SettingsClient({
  settings,
  campaigns,
  auditLogs = []
}: {
  settings: AppSettings;
  campaigns: Campaign[];
  auditLogs?: AuditLog[];
}) {
  const [deadlineReminderDays, setDeadlineReminderDays] = useState(settings.deadline_reminder_days);
  const [maxConcurrentEdits, setMaxConcurrentEdits] = useState(settings.max_concurrent_edits);
  const [campaignName, setCampaignName] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function persistSettings() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => updateSettings({
        twoStepApproval: false,
        deadlineReminderDays,
        maxConcurrentEdits
      }));
      setMessage(response.ok ? "Settings saved." : response.message ?? "Unable to save settings.");
    });
  }

  function persistCampaign() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => saveCampaign({
        id: editingCampaign?.id,
        name: campaignName,
        description: campaignDescription,
        active: editingCampaign?.active ?? true
      }));
      setMessage(response.ok ? (editingCampaign ? "Campaign updated." : "Campaign created.") : response.message ?? "Unable to save campaign.");
      if (response.ok) {
        resetCampaignForm();
      }
    });
  }

  function editCampaign(campaign: Campaign) {
    setEditingCampaign(campaign);
    setCampaignName(campaign.name);
    setCampaignDescription(campaign.description ?? "");
    setMessage(null);
  }

  function resetCampaignForm() {
    setEditingCampaign(null);
    setCampaignName("");
    setCampaignDescription("");
  }

  function toggleCampaign(campaign: Campaign) {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => saveCampaign({
        id: campaign.id,
        name: campaign.name,
        description: campaign.description ?? undefined,
        active: !campaign.active
      }));
      setMessage(response.ok ? `${campaign.name} ${campaign.active ? "deactivated" : "activated"}.` : response.message ?? "Unable to update campaign.");
    });
  }

  function removeCampaign(campaign: Campaign) {
    if (!confirm(`Delete "${campaign.name}"? This cannot be undone.`)) return;
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => deleteCampaign(campaign.id));
      setMessage(response.ok ? `${campaign.name} deleted.` : response.message ?? "Unable to delete campaign.");
    });
  }

  return (
    <main className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Production workflow, reminders, and campaign setup.</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)]">
        <section className="panel p-5">
          <h2 className="section-heading">Production workflow</h2>
          <div className="mt-5 space-y-5">
            <Field label="Deadline reminder days">
              <Input
                type="number"
                min={1}
                max={30}
                value={deadlineReminderDays}
                onChange={(event) => setDeadlineReminderDays(Number(event.target.value))}
              />
            </Field>
            <Field label="Max concurrent edits per editor" hint="How many videos an editor can have in progress at once.">
              <Input
                type="number"
                min={1}
                max={10}
                value={maxConcurrentEdits}
                onChange={(event) => setMaxConcurrentEdits(Number(event.target.value))}
              />
            </Field>
            <Button className="w-full" disabled={isPending} onClick={persistSettings}>
              {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Save reminder settings
            </Button>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-border p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="section-heading">Campaigns</h2><p className="mt-1 text-xs text-muted-foreground">{campaigns.filter((item) => item.active).length} active of {campaigns.length}</p></div>{editingCampaign ? <Button size="sm" variant="ghost" onClick={resetCampaignForm}><RotateCcw className="size-3.5" aria-hidden />Cancel edit</Button> : null}</div>
          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(180px,0.7fr)_minmax(240px,1fr)_auto] md:items-end">
            <Field label="Campaign name">
              <Input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} />
            </Field>
            <Field label="Description">
              <Textarea className="min-h-10" value={campaignDescription} onChange={(event) => setCampaignDescription(event.target.value)} />
            </Field>
            <Button disabled={isPending || !campaignName.trim()} onClick={persistCampaign}>
              {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : editingCampaign ? <CheckCircle2 className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              {editingCampaign ? "Save" : "Add"}
            </Button>
          </div></div>
            <div className="divide-y divide-border">
              {campaigns.map((campaign) => (
                <div key={campaign.id} className={`flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-muted ${!campaign.active ? "bg-muted/60" : ""}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{campaign.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{campaign.description ?? "No description"}</p>
                  </div>
                  <div className="flex items-center gap-1"><span className={`mr-2 inline-flex items-center gap-1.5 text-xs font-medium ${campaign.active ? "text-success" : "text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${campaign.active ? "bg-success" : "bg-border"}`} />{campaign.active ? "Active" : "Inactive"}</span><Button size="icon" variant="ghost" className="size-9" title="Edit campaign" onClick={() => editCampaign(campaign)}><Pencil className="size-4" aria-hidden /></Button><Button size="icon" variant="ghost" className="size-9" title={campaign.active ? "Deactivate campaign" : "Activate campaign"} onClick={() => toggleCampaign(campaign)}><Power className="size-4" aria-hidden /></Button><Button size="icon" variant="ghost" className="size-9 text-destructive hover:text-destructive" title="Delete campaign" onClick={() => removeCampaign(campaign)}><Trash2 className="size-4" aria-hidden /></Button></div>
                </div>
              ))}
            </div>
        </section>
      </div>
      {message ? <p className="mt-4 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-soft">{message}</p> : null}

      <section className="panel mt-5 overflow-hidden">
        <div className="border-b border-border p-5">
          <h2 className="section-heading">Audit log</h2>
          <p className="mt-1 text-xs text-muted-foreground">Latest 100 administrative and workflow events.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-border bg-muted/80 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {auditLogs.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No audit events yet.</td></tr>
              ) : auditLogs.map((log) => (
                <tr key={log.id} className="transition hover:bg-muted/80">
                  <td className="px-4 py-3 font-medium capitalize text-foreground">{log.action.replaceAll("_", " ")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{log.actor?.name ?? "System"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{log.target_type}{log.target_id ? ` #${log.target_id.slice(0, 8)}` : ""}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(log.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
