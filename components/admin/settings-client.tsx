"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  FolderArchive,
  FolderKanban,
  Loader2,
  Power,
  ScrollText,
  Sliders,
  Trash2
} from "lucide-react";
import { deleteCampaign, saveCampaign, updateSettings } from "@/app/actions/admin";
import { runServerAction } from "@/lib/client-action";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { AppSettings, AuditLog, Campaign } from "@/lib/types";
import type { DownloadLog } from "@/lib/download-logs";
import { cn, formatDateTime } from "@/lib/utils";
import { DownloadLogsPanel } from "@/components/admin/download-logs-panel";

function resolveSettingsTab(): "workflow" | "downloads" | "audit" {
  if (typeof window === "undefined") return "workflow";
  const rawHash = (window.location.hash || "").replace(/^#/, "").toLowerCase();
  if (rawHash === "downloads" || rawHash.startsWith("download")) return "downloads";
  if (rawHash === "audit") return "audit";
  if (rawHash === "workflow") return "workflow";

  try {
    const params = new URLSearchParams(window.location.search);
    const tabParam = (params.get("tab") || params.get("section") || "").toLowerCase();
    if (tabParam === "downloads" || tabParam.startsWith("download")) return "downloads";
    if (tabParam === "audit") return "audit";
    if (tabParam === "workflow") return "workflow";
  } catch {
    // ignore
  }

  return "workflow";
}

export function SettingsClient({
  settings,
  campaigns,
  auditLogs = [],
  downloadLogs = []
}: {
  settings: AppSettings;
  campaigns: Campaign[];
  auditLogs?: AuditLog[];
  downloadLogs?: DownloadLog[];
}) {
  const [activeTab, setActiveTab] = useState<"workflow" | "downloads" | "audit">(resolveSettingsTab);
  const [deadlineReminderDays, setDeadlineReminderDays] = useState(settings.deadline_reminder_days);
  const [maxConcurrentEdits, setMaxConcurrentEdits] = useState(settings.max_concurrent_edits);
  const [allowManagerFinalApproval, setAllowManagerFinalApproval] = useState(settings.allow_manager_final_approval ?? true);
  const [managerCreativeScope, setManagerCreativeScope] = useState(settings.manager_creative_scope ?? "all");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const syncFromLocation = () => {
      const target = resolveSettingsTab();
      setActiveTab((prev) => (prev !== target ? target : prev));
    };

    syncFromLocation();
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, []);

  function handleTabClick(tab: "workflow" | "downloads" | "audit") {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      window.location.hash = `#${tab}`;
    }
  }

  function persistSettings() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => updateSettings({
        twoStepApproval: false,
        deadlineReminderDays,
        maxConcurrentEdits,
        allowManagerFinalApproval,
        managerCreativeScope
      }));
      setMessage(response.ok ? "Settings saved." : response.message ?? "Unable to save settings.");
    });
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
        <p className="mt-1 text-sm text-muted-foreground">Production workflow, download logs, reminders, and campaign setup.</p>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center gap-1 sm:gap-2 border-b border-border mb-6 overflow-x-auto">
        <button
          type="button"
          onClick={() => handleTabClick("workflow")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs sm:text-sm font-medium transition -mb-px whitespace-nowrap",
            activeTab === "workflow"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Sliders className="size-4" />
          Workflow &amp; Campaigns
        </button>

        <button
          type="button"
          onClick={() => handleTabClick("downloads")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs sm:text-sm font-medium transition -mb-px whitespace-nowrap",
            activeTab === "downloads"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <FolderArchive className="size-4" />
          Download Logs
          {downloadLogs.length > 0 && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
              {downloadLogs.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => handleTabClick("audit")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs sm:text-sm font-medium transition -mb-px whitespace-nowrap",
            activeTab === "audit"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <ScrollText className="size-4" />
          Audit Log
          {auditLogs.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {auditLogs.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === "downloads" ? (
        <DownloadLogsPanel initialLogs={downloadLogs} />
      ) : activeTab === "audit" ? (
        <section className="panel overflow-hidden">
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
      ) : (
        <>
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
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Final approval hierarchy</label>
                  <p className="text-xs text-muted-foreground">Control who has authority to grant final approval for creatives in the Creative Library.</p>
                  <div className="mt-2 grid gap-2">
                    <button
                      type="button"
                      onClick={() => setAllowManagerFinalApproval(true)}
                      className={cn(
                        "flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
                        allowManagerFinalApproval
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <span className={cn("size-2 rounded-full", allowManagerFinalApproval ? "bg-primary" : "bg-border")} />
                        Admin &amp; Manager
                      </span>
                      <span className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        Both administrators and managers can give final approval to creatives.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllowManagerFinalApproval(false)}
                      className={cn(
                        "flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
                        !allowManagerFinalApproval
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <span className={cn("size-2 rounded-full", !allowManagerFinalApproval ? "bg-primary" : "bg-border")} />
                        Admin Only
                      </span>
                      <span className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        Two-stage approval: Managers review and approve first, then administrators grant final approval.
                      </span>
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Manager creative visibility in Ads performance</label>
                  <p className="text-xs text-muted-foreground">Control whether managers see all team creatives or only their own in Ads performance.</p>
                  <div className="mt-2 grid gap-2">
                    <button
                      type="button"
                      onClick={() => setManagerCreativeScope("all")}
                      className={cn(
                        "flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
                        managerCreativeScope === "all"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <span className={cn("size-2 rounded-full", managerCreativeScope === "all" ? "bg-primary" : "bg-border")} />
                        All creatives across team
                      </span>
                      <span className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        Managers see all Meta ads, performance numbers, and creatives across the entire workspace.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setManagerCreativeScope("own")}
                      className={cn(
                        "flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
                        managerCreativeScope === "own"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <span className={cn("size-2 rounded-full", managerCreativeScope === "own" ? "bg-primary" : "bg-border")} />
                        Own creatives only
                      </span>
                      <span className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        Managers only see creatives and Meta ads where they are the creator, editor, or attributed user.
                      </span>
                    </button>
                  </div>
                </div>
                <Button className="w-full" disabled={isPending} onClick={persistSettings}>
                  {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  Save workflow settings
                </Button>
              </div>
            </section>

            <section className="panel overflow-hidden">
              <div className="border-b border-border p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="section-heading">Campaigns</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {campaigns.filter((item) => item.active).length} active of {campaigns.length} total
                    </p>
                  </div>
                  <Link
                    href="/campaigns"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground shadow-xs hover:bg-muted transition"
                  >
                    <FolderKanban className="size-3.5" aria-hidden />
                    Open Campaigns
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Campaigns, target creative goals, and production overviews are created and managed directly in the Campaigns dashboard.
                </p>
              </div>

              <div className="divide-y divide-border">
                {campaigns.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-sm text-muted-foreground">No campaigns created yet.</p>
                    <Link
                      href="/campaigns"
                      className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs hover:bg-primary/90 transition"
                    >
                      <FolderKanban className="size-3.5" aria-hidden />
                      Create campaign in Campaigns
                    </Link>
                  </div>
                ) : (
                  campaigns.map((campaign) => (
                    <div
                      key={campaign.id}
                      className={cn(
                        "flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-muted",
                        !campaign.active && "bg-muted/60"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/campaigns/${campaign.id}`}
                            className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                          >
                            {campaign.name}
                          </Link>
                          {campaign.video_goal ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                              Goal: {campaign.video_goal}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {campaign.description ?? "No description"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className={cn(
                            "mr-2 inline-flex items-center gap-1.5 text-xs font-medium",
                            campaign.active ? "text-success" : "text-muted-foreground"
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              campaign.active ? "bg-success" : "bg-border"
                            )}
                          />
                          {campaign.active ? "Active" : "Inactive"}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-9"
                          title={campaign.active ? "Deactivate campaign" : "Activate campaign"}
                          onClick={() => toggleCampaign(campaign)}
                        >
                          <Power className="size-4" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-9 text-destructive hover:text-destructive"
                          title="Delete campaign"
                          onClick={() => removeCampaign(campaign)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
          {message ? <p className="mt-4 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-soft">{message}</p> : null}
        </>
      )}
    </main>
  );
}
