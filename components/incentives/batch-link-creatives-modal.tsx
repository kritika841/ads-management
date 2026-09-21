"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { linkIncentiveCreatives } from "@/app/actions/incentives";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { runServerAction } from "@/lib/client-action";
import type { IncentiveCampaign, MetaAd } from "@/lib/incentives";

type EligibleAd = { id: string; name: string; product_id: string | null; creator?: { name: string } | null; editor?: { name: string } | null };
type CreativeRow = { key: number; adId: string; metaAdId: string; launchedOn: string };

export function BatchLinkCreativesModal({ campaigns, ads, metaAds, initialCampaignId, onClose }: { campaigns: IncentiveCampaign[]; ads: EligibleAd[]; metaAds: MetaAd[]; initialCampaignId: string; onClose: () => void }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [campaignId, setCampaignId] = useState(initialCampaignId || campaigns[0]?.id || "");
  const [rows, setRows] = useState<CreativeRow[]>([{ key: 1, adId: "", metaAdId: "", launchedOn: today }]);
  const [nextKey, setNextKey] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const campaign = campaigns.find((item) => item.id === campaignId);
  const matchingAds = ads.filter((ad) => ad.product_id === campaign?.product_id);

  function updateRow(key: number, patch: Partial<CreativeRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function addRow() {
    setRows((current) => [...current, { key: nextKey, adId: "", metaAdId: "", launchedOn: today }]);
    setNextKey((value) => value + 1);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await runServerAction(() => linkIncentiveCreatives({
        campaignId,
        creatives: rows.map(({ adId, metaAdId, launchedOn }) => ({ adId, metaAdId, launchedOn }))
      }));
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.message ?? "Unable to track creatives.");
      }
    });
  }

  const complete = Boolean(campaignId) && rows.every((row) => row.adId && row.metaAdId && row.launchedOn);
  return (
    <Modal open labelledBy="batch-link-title" onClose={onClose}>
      <section className="mx-auto w-full max-w-3xl rounded-xl bg-card shadow-float">
        <div className="flex h-16 items-center justify-between border-b border-border px-5">
          <div><h2 id="batch-link-title" className="text-lg font-semibold text-foreground">Add campaign videos</h2><p className="text-xs text-muted-foreground">Add multiple product-matching creatives in one submission.</p></div>
          <Button size="icon" variant="ghost" onClick={onClose} title="Close"><X className="size-5" /></Button>
        </div>
        <div className="space-y-4 p-5">
          <Field label="Product campaign">
            <Select value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setRows([{ key: nextKey, adId: "", metaAdId: "", launchedOn: today }]); setNextKey((value) => value + 1); }}>
              {campaigns.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.product?.name}</option>)}
            </Select>
          </Field>
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(150px,.55fr)_150px_40px] gap-3 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground sm:grid"><span>Creative</span><span>Meta ad ID</span><span>Launch date</span><span /></div>
            <div className="divide-y divide-border">
              {rows.map((row, index) => {
                const selectedElsewhere = new Set(rows.filter((item) => item.key !== row.key).map((item) => item.adId));
                return <div key={row.key} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(150px,.55fr)_150px_40px] sm:items-center"><Select aria-label={`Creative ${index + 1}`} value={row.adId} onChange={(event) => updateRow(row.key, { adId: event.target.value })}><option value="">Choose creative {index + 1}</option>{matchingAds.filter((ad) => !selectedElsewhere.has(ad.id)).map((ad) => <option key={ad.id} value={ad.id}>{ad.name}{ad.creator?.name ? ` · ${ad.creator.name}` : ""}{ad.editor?.name ? ` / ${ad.editor.name}` : ""}</option>)}</Select><Input aria-label={`Meta ad ID ${index + 1}`} inputMode="numeric" list="meta-ad-options" placeholder="Meta ad ID" value={row.metaAdId} onChange={(event) => updateRow(row.key, { metaAdId: event.target.value.replace(/\D/g, "") })} /><Input aria-label={`Launch date ${index + 1}`} type="date" min={campaign?.starts_on} max={campaign?.ends_on ?? undefined} value={row.launchedOn} onChange={(event) => updateRow(row.key, { launchedOn: event.target.value })} /><Button size="icon" variant="ghost" className="size-9 text-destructive" title="Remove row" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="size-4" /></Button></div>;
              })}
            </div>
          </div>
          <datalist id="meta-ad-options">{metaAds.map((ad) => <option key={ad.id} value={ad.id}>{ad.name}</option>)}</datalist>
          {!matchingAds.length ? <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">No eligible creatives match {campaign?.product?.name ?? "this product"}. Create or update videos in the Creative library first.</p> : null}
          <Button size="sm" variant="ghost" onClick={addRow} disabled={rows.length >= matchingAds.length || rows.length >= 100}><Plus className="size-4" />Add another video</Button>
          <p className="text-xs text-muted-foreground">The campaign belongs to the product. Every video is tracked independently against its own Meta ad performance.</p>
          {error ? <p className="rounded-lg bg-muted px-3 py-2 text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={pending || !complete}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Track {rows.length} video{rows.length === 1 ? "" : "s"}</Button></div>
      </section>
    </Modal>
  );
}
