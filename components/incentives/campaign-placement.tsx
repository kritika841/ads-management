"use client";

import { useMemo, useState, useTransition } from "react";
import { Crosshair, Layers, LayoutList, Link2, Loader2, PanelLeft, ShieldAlert, Video, X } from "lucide-react";
import { updateCampaignPlacement } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { runServerAction } from "@/lib/client-action";
import { buildMetaIndex, metaAdsForLibraryAd, sumMeta } from "@/lib/campaign-ad-stats";
import type { IncentiveCampaign, IncentiveCreative, MetaAd } from "@/lib/incentives";
import {
  ADS_PERFORMANCE_NAV_INFO,
  PLACEABLE_TABS,
  tabForMetaCampaignDestination,
  type AdsPerformanceNavItemKey,
  type CampaignPlacement,
  type CampaignPlacementMode
} from "@/lib/metric-visibility";
import { cn } from "@/lib/utils";

export type MetaCampaignOption = { id: string; name: string };

export function metaCampaignOptions(metaAds: MetaAd[]): MetaCampaignOption[] {
  const map = new Map<string, string>();
  for (const ad of metaAds) {
    if (ad.campaign_id) map.set(ad.campaign_id, ad.campaign_name ?? ad.campaign_id);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The existing submenu a placement pins this campaign into (null if it isn't pinned into one). */
export function pinnedTabForPlacement(
  placement: CampaignPlacement | undefined,
  campaignDestinations: Record<string, { destination: string }> | undefined
): AdsPerformanceNavItemKey | null {
  if (!placement) return null;
  if (placement.mode === "existing_tab") return placement.tab_key ?? null;
  if (placement.mode === "with_meta_campaign" && placement.meta_campaign_id) {
    return tabForMetaCampaignDestination(campaignDestinations?.[placement.meta_campaign_id]?.destination);
  }
  return null;
}

export function placementSummary(placement: CampaignPlacement | undefined, metaCampaigns: MetaCampaignOption[]): string {
  if (!placement) return "Campaigns tab only";
  switch (placement.mode) {
    case "submenu":
      return `Own submenu${placement.submenu_label ? `: ${placement.submenu_label}` : ""}`;
    case "existing_tab":
      return `Pinned in ${placement.tab_key ? ADS_PERFORMANCE_NAV_INFO[placement.tab_key].label : "a submenu"}`;
    case "with_meta_campaign": {
      const name = metaCampaigns.find((m) => m.id === placement.meta_campaign_id)?.name ?? placement.meta_campaign_id;
      return `Alongside Meta campaign: ${name}`;
    }
    case "override_all":
      return "Overrides all other ads";
    default:
      return "Campaigns tab only";
  }
}

const OPTIONS: Array<{
  mode: CampaignPlacementMode;
  title: string;
  description: string;
  icon: typeof Layers;
}> = [
  { mode: "campaigns_only", title: "Campaigns tab only", description: "Not shown anywhere else (default).", icon: LayoutList },
  { mode: "submenu", title: "Its own new submenu", description: "Adds a dedicated item under Ads performance in the sidebar.", icon: PanelLeft },
  { mode: "existing_tab", title: "Inside an existing submenu", description: "Pinned at the top of Overview, Active, Testing, Winning, Losing or Paused.", icon: Layers },
  { mode: "with_meta_campaign", title: "Alongside a Meta campaign", description: "Shown wherever the chosen Meta campaign is displayed.", icon: Link2 },
  { mode: "override_all", title: "Override all other ads", description: "Selected non-admin users see only this campaign's ads everywhere in Ads performance.", icon: Crosshair }
];

export function PlacementPicker({
  value,
  onChange,
  campaignName,
  metaCampaigns
}: {
  value: CampaignPlacement | null;
  onChange: (next: CampaignPlacement | null) => void;
  campaignName: string;
  metaCampaigns: MetaCampaignOption[];
}) {
  const mode: CampaignPlacementMode = value?.mode ?? "campaigns_only";

  function choose(next: CampaignPlacementMode) {
    if (next === "campaigns_only") return onChange(null);
    if (next === "submenu") return onChange({ mode: "submenu", submenu_label: value?.submenu_label ?? "" });
    if (next === "existing_tab") return onChange({ mode: "existing_tab", tab_key: value?.tab_key ?? "overview" });
    if (next === "with_meta_campaign") {
      return onChange({ mode: "with_meta_campaign", meta_campaign_id: value?.meta_campaign_id ?? metaCampaigns[0]?.id ?? "" });
    }
    return onChange({ mode: "override_all" });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = mode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => choose(opt.mode)}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3 text-left transition",
                active ? "border-primary bg-primary/10 shadow-2xs" : "border-border bg-card hover:border-primary/40"
              )}
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              <div>
                <p className="text-xs font-semibold text-foreground">{opt.title}</p>
                <p className="text-[11px] leading-4 text-muted-foreground">{opt.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {mode === "submenu" ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3">
          <label className="text-xs font-medium text-foreground" htmlFor="placement-submenu-label">Sidebar label</label>
          <Input
            id="placement-submenu-label"
            className="h-8 text-xs"
            maxLength={40}
            placeholder={campaignName.trim() || "Submenu name"}
            value={value?.submenu_label ?? ""}
            onChange={(e) => onChange({ mode: "submenu", submenu_label: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">Leave empty to use the campaign name. Only users who can see this campaign get the menu item.</p>
        </div>
      ) : null}

      {mode === "existing_tab" ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3">
          <label className="text-xs font-medium text-foreground" htmlFor="placement-tab">Pin into submenu</label>
          <Select
            id="placement-tab"
            className="h-8 text-xs"
            value={value?.tab_key ?? "overview"}
            onChange={(e) => onChange({ mode: "existing_tab", tab_key: e.target.value as AdsPerformanceNavItemKey })}
          >
            {PLACEABLE_TABS.map((key) => (
              <option key={key} value={key}>{ADS_PERFORMANCE_NAV_INFO[key].label}</option>
            ))}
          </Select>
        </div>
      ) : null}

      {mode === "with_meta_campaign" ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3">
          <label className="text-xs font-medium text-foreground" htmlFor="placement-meta">Meta campaign</label>
          <Select
            id="placement-meta"
            className="h-8 text-xs"
            value={value?.meta_campaign_id ?? ""}
            onChange={(e) => onChange({ mode: "with_meta_campaign", meta_campaign_id: e.target.value })}
          >
            {metaCampaigns.length === 0 ? <option value="">No Meta campaigns synced</option> : null}
            {metaCampaigns.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Appears in the submenu that campaign is routed to (Testing → Testing creatives, Scaling → Winning creatives, otherwise Overview).
          </p>
        </div>
      ) : null}

      {mode === "override_all" ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[11px] leading-4 text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            Every non-admin user who can see this campaign will see <strong>only</strong> its ads across all Ads performance views.
            If the campaign is visible to all users, that is the whole team. Admins always keep full access.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function CampaignPlacementModal({
  campaign,
  current,
  metaAds,
  onClose,
  onSuccess
}: {
  campaign: IncentiveCampaign;
  current: CampaignPlacement | undefined;
  metaAds: MetaAd[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<CampaignPlacement | null>(current ?? null);
  const metaCampaigns = useMemo(() => metaCampaignOptions(metaAds), [metaAds]);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await runServerAction(() => updateCampaignPlacement({ campaignId: campaign.id, placement: value }));
      if (res.ok) onSuccess();
      else setError(res.message ?? "Failed to save placement.");
    });
  }

  return (
    <Modal open labelledBy="placement-modal-title" onClose={onClose}>
      <section className="mx-auto w-full max-w-xl overflow-y-auto rounded-xl bg-card shadow-float max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="placement-modal-title" className="text-lg font-semibold text-foreground">Where to display “{campaign.name}”</h2>
            <p className="text-xs text-muted-foreground">Choose where this campaign&apos;s ads appear for the users who can see it.</p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="size-4" /></Button>
        </div>
        <div className="space-y-3 p-5">
          <PlacementPicker value={value} onChange={setValue} campaignName={campaign.name} metaCampaigns={metaCampaigns} />
          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/10 px-5 py-3.5">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save placement
          </Button>
        </div>
      </section>
    </Modal>
  );
}

/** A campaign's curated ads, rendered inside a submenu it has been placed into. */
export function PlacedCampaignPanel({
  campaign,
  creatives,
  metaAds,
  label
}: {
  campaign: IncentiveCampaign;
  creatives: IncentiveCreative[];
  metaAds: MetaAd[];
  label?: string;
}) {
  const index = useMemo(() => buildMetaIndex(metaAds), [metaAds]);
  const rows = useMemo(
    () =>
      creatives.map((cr) => {
        const metas = metaAdsForLibraryAd(index, cr.ad_id, cr.ad?.name ?? "", cr.meta_ad_id);
        return { cr, ...sumMeta(metas), metaCount: metas.length };
      }).sort((a, b) => b.spend - a.spend),
    [creatives, index]
  );
  const totals = rows.reduce((acc, r) => ({ spend: acc.spend + r.spend, purchases: acc.purchases + r.purchases }), { spend: 0, purchases: 0 });

  return (
    <section className="panel mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="section-heading">{label || campaign.name}</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Internal campaign</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {rows.length} ad{rows.length === 1 ? "" : "s"} · Spend <strong className="text-foreground">₹{totals.spend.toLocaleString("en-IN")}</strong> · Orders <strong className="text-foreground">{totals.purchases.toLocaleString("en-IN")}</strong>
          </p>
        </div>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/70 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Ad / Creative</th>
                <th className="px-4 py-2.5">Creator / Editor</th>
                <th className="px-4 py-2.5">Spend</th>
                <th className="px-4 py-2.5">Orders</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ cr, spend, purchases, metaCount }) => (
                <tr key={cr.id} className="bg-card hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
                        {cr.ad?.thumbnail_url ? <img src={cr.ad.thumbnail_url} alt="" className="size-full object-cover" /> : <Video className="size-3.5 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{cr.ad?.name ?? `Creative ${cr.ad_id}`}</p>
                        <p className="text-[10px] text-muted-foreground">{metaCount} Meta ad{metaCount === 1 ? "" : "s"} linked</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    <p className="font-medium text-foreground">{cr.creator?.name ?? cr.ad?.creator?.name ?? "No creator"}</p>
                    <p className="text-[10px] opacity-80">{cr.editor?.name ?? cr.ad?.editor?.name ?? "No editor"}</p>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums font-medium text-foreground">₹{spend.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-2.5 tabular-nums text-foreground">{purchases}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-8 text-center text-xs text-muted-foreground">No ads are assigned to this campaign yet.</div>
      )}
    </section>
  );
}
