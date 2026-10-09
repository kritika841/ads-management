"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArchiveRestore, ChevronDown, ChevronUp, Clock, FileText, FolderKanban, Loader2, Trash2, Video } from "lucide-react";
import {
  purgeCampaignFromBin,
  purgeCreativeFromBin,
  restoreCampaignFromBin,
  restoreCreativeFromBin,
  updateRetentionSettings
} from "@/app/actions/recycle-bin";
import { RetentionDaysEditor } from "@/components/admin/retention-days-editor";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { runServerAction } from "@/lib/client-action";
import type { BinnedCampaign, BinnedCreative, RecycleBinSnapshot } from "@/lib/recycle-bin";
import { DEFAULT_RECYCLE_BIN_RETENTION_DAYS, formatRetentionDays } from "@/lib/retention";
import { cn, formatDateTime } from "@/lib/utils";

function timeLeft(expiresAt: string): { label: string; urgent: boolean } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return { label: "Purging soon", urgent: true };
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days >= 1) return { label: `${days}d ${hours % 24}h left`, urgent: days < 1 };
  return { label: `${Math.max(1, hours)}h left`, urgent: true };
}

function stageLabel(stage: string) {
  return stage.replaceAll("_", " ");
}

/**
 * Recycle Bin for deleted campaigns, creatives and scripts. Admins and managers can restore;
 * only admins can delete forever or change how many days items are retained.
 */
export function RecycleBinPanel({
  snapshot,
  role
}: {
  snapshot: RecycleBinSnapshot;
  role: "admin" | "manager";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const isAdmin = role === "admin";
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retentionDays, setRetentionDays] = useState(snapshot.retentionDays || DEFAULT_RECYCLE_BIN_RETENTION_DAYS);

  const total = snapshot.campaigns.length + snapshot.creatives.length;

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveRetention(days: number) {
    const response = await runServerAction(() => updateRetentionSettings({ recycleBinDays: days }));
    if (!response.ok) {
      toast({ title: "Retention not saved", description: response.message ?? "Unable to update retention.", tone: "error" });
      return false;
    }
    setRetentionDays(days);
    toast({ title: "Recycle Bin retention updated", description: `Deleted items are now kept for ${formatRetentionDays(days)}.`, tone: "success" });
    router.refresh();
    return true;
  }

  function run(key: string, action: () => Promise<{ ok: boolean; message?: string }>, successTitle: string, name: string) {
    if (busyKey) return;
    setBusyKey(key);
    startTransition(async () => {
      const response = await runServerAction(action);
      setBusyKey(null);
      if (!response.ok) {
        toast({ title: "Action failed", description: response.message ?? "Please try again.", tone: "error" });
        return;
      }
      toast({ title: successTitle, description: name, tone: "success" });
      router.refresh();
    });
  }

  function restoreCampaign(item: BinnedCampaign) {
    run(`campaign:${item.id}`, () => restoreCampaignFromBin(item.id), "Campaign restored", item.unlinkedCreatives.length ? `${item.name} restored and ${item.unlinkedCreatives.length} creative${item.unlinkedCreatives.length === 1 ? "" : "s"} re-linked.` : `${item.name} restored.`);
  }
  function restoreCreative(item: BinnedCreative) {
    run(`ad:${item.id}`, () => restoreCreativeFromBin(item.id), "Creative restored", item.name);
  }
  function purgeCampaign(item: BinnedCampaign) {
    if (!confirm(`Permanently delete the campaign "${item.name}"? Its creatives are not deleted; they stay in the library without a campaign. This cannot be undone.`)) return;
    run(`campaign:${item.id}`, () => purgeCampaignFromBin(item.id), "Deleted forever", item.name);
  }
  function purgeCreative(item: BinnedCreative) {
    if (!confirm(`Permanently delete "${item.name}"? Its video record, script and history will be lost.`)) return;
    run(`ad:${item.id}`, () => purgeCreativeFromBin(item.id), "Deleted forever", item.name);
  }

  const busy = isPending || busyKey !== null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">In the bin</span>
            <Trash2 className="size-4 text-primary" aria-hidden />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">{total}</span>
            <span className="text-xs text-muted-foreground">
              {snapshot.campaigns.length} campaign{snapshot.campaigns.length === 1 ? "" : "s"} · {snapshot.creatives.length} creative{snapshot.creatives.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs sm:col-span-2">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Retention Policy</span>
            <Clock className="size-4 text-warning" aria-hidden />
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <RetentionDaysEditor value={retentionDays} editable={isAdmin} onSave={saveRetention} ariaLabel="recycle bin retention in days" />
            <span className="text-xs text-muted-foreground">
              Deleted items are restorable for this long, then removed permanently.{isAdmin ? " Lowering it removes older items at the next sweep." : " Only an administrator can change this."}
            </span>
          </div>
        </div>
      </div>

      {!snapshot.ready ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            The Recycle Bin is not active yet because the latest database migration has not been applied
            (<code className="rounded bg-muted px-1 text-xs">20261006120000_recycle_bin_retention_and_editing_freeze</code>). Until then, deleting a campaign or creative removes it permanently.
          </p>
        </div>
      ) : null}

      {snapshot.ready && total === 0 ? (
        <section className="panel p-10 text-center">
          <ArchiveRestore className="mx-auto size-9 text-muted-foreground/50" aria-hidden />
          <p className="mt-3 text-sm font-medium text-foreground">The Recycle Bin is empty</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Deleted campaigns, creatives and scripts show up here and can be restored for {formatRetentionDays(retentionDays)}.
          </p>
        </section>
      ) : null}

      {snapshot.campaigns.length > 0 ? (
        <section className="panel overflow-hidden border border-border shadow-xs">
          <div className="border-b border-border p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <FolderKanban className="size-4 text-primary" aria-hidden /> Deleted campaigns
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Creatives are never deleted with a campaign: they stay in the library without a campaign. Restoring the campaign re-links the ones that are still unassigned.</p>
          </div>
          <ul className="divide-y divide-border">
            {snapshot.campaigns.map((item) => {
              const left = timeLeft(item.expiresAt);
              const open = expanded.has(item.id);
              const rowBusy = busyKey === `campaign:${item.id}`;
              return (
                <li key={item.id} className="p-4 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Deleted {formatDateTime(item.deletedAt)}{item.deletedByName ? ` by ${item.deletedByName}` : ""} · {item.unlinkedCreatives.length} creative{item.unlinkedCreatives.length === 1 ? "" : "s"} unlinked
                      </p>
                      {item.unlinkedCreatives.length > 0 ? (
                        <button type="button" onClick={() => toggle(item.id)} className="mt-1 inline-flex items-center gap-0.5 text-xs text-primary hover:underline" aria-expanded={open}>
                          {open ? "Hide creatives" : "View unlinked creatives"}
                          {open ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
                        </button>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 text-xs font-medium", left.urgent ? "text-warning" : "text-muted-foreground")}>
                        <Clock className="size-3" aria-hidden /> {left.label}
                      </span>
                      <Button size="sm" disabled={busy} onClick={() => restoreCampaign(item)} className="h-8 gap-1.5 text-xs">
                        {rowBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ArchiveRestore className="size-3.5" aria-hidden />}
                        Restore
                      </Button>
                      {isAdmin ? (
                        <Button size="icon" variant="ghost" disabled={busy} onClick={() => purgeCampaign(item)} className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete forever" aria-label={`Delete ${item.name} forever`}>
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {open ? (
                    <div className="mt-3 flex flex-wrap gap-1.5 rounded-lg bg-muted/30 p-3">
                      {item.unlinkedCreatives.map((creative) => (
                        <span key={creative.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-foreground">
                          {creative.hasVideo ? <Video className="size-3 text-primary" aria-hidden /> : <FileText className="size-3 text-muted-foreground" aria-hidden />}
                          {creative.name}
                          <span className="text-muted-foreground">· {stageLabel(creative.productionStage)}{creative.hasScript ? " · script" : ""}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {snapshot.creatives.length > 0 ? (
        <section className="panel overflow-hidden border border-border shadow-xs">
          <div className="border-b border-border p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Video className="size-4 text-primary" aria-hidden /> Deleted creatives &amp; scripts
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">A restored creative returns to its original campaign with its video, script and history.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-muted/60 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Creative</th>
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Deleted</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {snapshot.creatives.map((item) => {
                  const left = timeLeft(item.expiresAt);
                  const rowBusy = busyKey === `ad:${item.id}`;
                  return (
                    <tr key={item.id} className="transition hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{item.name}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="capitalize">{stageLabel(item.productionStage)}</span>
                          {item.hasVideo ? <span className="inline-flex items-center gap-0.5"><Video className="size-3" aria-hidden />video</span> : null}
                          {item.hasScript ? <span className="inline-flex items-center gap-0.5"><FileText className="size-3" aria-hidden />script</span> : null}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {item.campaignName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <div>{formatDateTime(item.deletedAt)}</div>
                        {item.deletedByName ? <div className="text-[11px] text-muted-foreground/70">by {item.deletedByName}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className={cn("inline-flex items-center gap-1 font-medium", left.urgent ? "text-warning" : "text-muted-foreground")}>
                          <Clock className="size-3" aria-hidden /> {left.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => restoreCreative(item)}
                            className="h-8 gap-1.5 text-xs"
                          >
                            {rowBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ArchiveRestore className="size-3.5" aria-hidden />}
                            Restore
                          </Button>
                          {isAdmin ? (
                            <Button size="icon" variant="ghost" disabled={busy} onClick={() => purgeCreative(item)} className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete forever" aria-label={`Delete ${item.name} forever`}>
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
