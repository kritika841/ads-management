"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Loader2, Plus, Tags } from "lucide-react";
import { getNextAdName, saveCreatorItem } from "@/app/actions/ads";
import { runServerAction } from "@/lib/client-action";
import { RichTextEditor } from "@/components/dashboard/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { platforms } from "@/lib/constants";
import { creatorControlledStages, creatorSelectableStages, creatorStatusOptionLabels, type CreatorControlledStage } from "@/lib/production-workflow";
import type { AdWithRelations, Campaign, Product, Profile } from "@/lib/types";

export function CreatorItemForm({
  profile,
  creators,
  editors,
  campaigns,
  products,
  initialAd,
  availableTags,
  editorWorkloads,
  onSaved
}: {
  profile: Profile;
  creators: Profile[];
  editors: Profile[];
  campaigns: Campaign[];
  products: Product[];
  initialAd?: AdWithRelations | null;
  availableTags: string[];
  editorWorkloads: Record<string, number>;
  onSaved?: (adId: string) => void;
}) {
  const router = useRouter();
  const activeCreators = creators.filter((item) => item.active && item.role === "content_creator");
  const activeEditors = editors.filter((item) => item.active && item.role === "editor");
  const defaultCreatorId = initialAd?.creator_id ?? (profile.role === "content_creator" ? profile.id : activeCreators[0]?.id ?? "");
  const initialStage = initialAd && creatorSelectableStages.includes(initialAd.production_stage as (typeof creatorSelectableStages)[number])
    ? initialAd.production_stage as CreatorControlledStage
    : creatorSelectableStages[0];
  const [name, setName] = useState(initialAd?.name ?? "");
  const [nameLoading, setNameLoading] = useState(!initialAd);
  const [campaignId, setCampaignId] = useState(initialAd?.campaign_id ?? campaigns[0]?.id ?? "");
  const [productId, setProductId] = useState(initialAd?.product_id ?? "");
  const [creatorId, setCreatorId] = useState(defaultCreatorId);
  const [scriptHtml, setScriptHtml] = useState(initialAd?.script_html ?? "");
  const [scriptText, setScriptText] = useState(initialAd?.script_text ?? "");
  const [stage, setStage] = useState<CreatorControlledStage>(initialStage);
  const [editorId, setEditorId] = useState(initialAd?.editor_id ?? "");
  const [rawFootageUrl, setRawFootageUrl] = useState(initialAd?.raw_footage_url ?? "");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(initialAd?.platforms ?? []);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialAd?.tags.map((tag) => tag.name) ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [deadline, setDeadline] = useState(initialAd?.deadline ?? "");
  const [notes, setNotes] = useState(initialAd?.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  useEffect(() => {
    if (initialAd || !creatorId) return;
    setNameLoading(true);
    getNextAdName(creatorId)
      .then((next) => setName(next))
      .catch(() => {/* keep empty */})
      .finally(() => setNameLoading(false));
  }, [creatorId, initialAd]);

  const isHandoff = stage === "ready_for_edit";
  const requiresRawFootage = creatorControlledStages.indexOf(stage) >= creatorControlledStages.indexOf("shoot_complete");
  const canChooseCreator = profile.role === "admin" || profile.role === "manager";
  const canSave = Boolean(name.trim() && campaignId && productId && creatorId && scriptText.trim() && (!requiresRawFootage || rawFootageUrl.trim()) && (!editorId || deadline));
  const tagOptions = useMemo(() => Array.from(new Set([...availableTags, ...selectedTags])).filter(Boolean).sort(), [availableTags, selectedTags]);

  function addTag() {
    const tags = tagDraft.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!tags.length) return;
    setSelectedTags((current) => Array.from(new Set([...current, ...tags])));
    setTagDraft("");
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => saveCreatorItem({
        id: initialAd?.id,
        name,
        campaignId,
        productId,
        creatorId,
        scriptHtml,
        scriptText,
        stage,
        editorId,
        rawFootageUrl,
        platforms: selectedPlatforms,
        tags: selectedTags,
        deadline,
        notes
      }));
      if (!response.ok || !response.adId) {
        setMessage(response.message ?? "Unable to save creator work.");
        return;
      }
      router.refresh();
      onSaved?.(response.adId);
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Ad name" hint={initialAd ? undefined : "Auto-generated unique ID — read only."}><div className="relative"><Input value={name} readOnly={!initialAd} className={`font-mono tracking-widest ${!initialAd ? "bg-muted cursor-default" : ""}`} aria-busy={nameLoading} />{nameLoading ? <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden /> : null}</div></Field>
        <Field label="Campaign"><Select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</Select></Field>
        <Field label="Product"><Select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select></Field>
        {canChooseCreator ? <Field label="Content creator"><Select value={creatorId} onChange={(event) => setCreatorId(event.target.value)}>{activeCreators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name}</option>)}</Select></Field> : null}
        <Field label="Current status"><Select value={stage} onChange={(event) => setStage(event.target.value as CreatorControlledStage)}>{creatorSelectableStages.map((item) => <option key={item} value={item}>{creatorStatusOptionLabels[item]}</option>)}</Select></Field>
      </div>

      <Field label="Script / copy" hint="Required for every status."><RichTextEditor value={scriptHtml} onChange={(html, text) => { setScriptHtml(html); setScriptText(text); }} /></Field>

      {requiresRawFootage ? (
        <section className="rounded-xl border border-primary/30 bg-accent/60 p-4">
          <h3 className="text-sm font-semibold text-foreground">{isHandoff ? "Editor handoff" : "Raw footage"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{isHandoff ? "Assigning an editor gives them private access to this script and raw footage. You can also leave it unassigned and assign one later." : "Add the raw footage folder link now that the shoot is complete."}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Raw footage folder" hint="Required."><div className="relative"><Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input className="pl-9" value={rawFootageUrl} onChange={(event) => setRawFootageUrl(event.target.value)} placeholder="https://drive.google.com/drive/folders/..." required /></div></Field>
            {isHandoff ? <Field label="Assign editor" hint="Optional — you can assign this later."><Select value={editorId} onChange={(event) => setEditorId(event.target.value)}><option value="">Choose editor</option>{activeEditors.map((editor) => <option key={editor.id} value={editor.id}>{editor.name} · {editorWorkloads[editor.id] ?? 0} assigned</option>)}</Select></Field> : null}
            {isHandoff ? <Field label="Deadline" hint={editorId ? "Required when an editor is assigned." : "Required once you assign an editor."}><Input type="date" value={deadline ?? ""} onChange={(event) => setDeadline(event.target.value)} required={Boolean(editorId)} /></Field> : null}
          </div>
        </section>
      ) : null}

      <Field label="Notes"><Textarea className="min-h-20" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Production context or instructions" /></Field>

      <Field label="Platforms"><div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{platforms.map((platform) => { const selected = selectedPlatforms.includes(platform); return <button key={platform} type="button" aria-pressed={selected} className={`flex h-10 items-center justify-between rounded-lg border px-3 text-sm transition-colors duration-150 ${selected ? "border-primary bg-accent text-primary" : "border-border bg-card text-muted-foreground hover:border-ring/50 hover:bg-muted"}`} onClick={() => setSelectedPlatforms((current) => selected ? current.filter((item) => item !== platform) : [...current, platform])}><span>{platform}</span>{selected ? <Check className="size-4" aria-hidden /> : null}</button>; })}</div></Field>

      <Field label="Tags"><div className="flex flex-wrap gap-2">{tagOptions.map((tag) => <button key={tag} type="button" className={`rounded-full border px-3 py-1.5 text-xs ${selectedTags.includes(tag) ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground"}`} onClick={() => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}>#{tag}</button>)}</div><div className="mt-2 flex gap-2"><div className="relative flex-1"><Tags className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input className="pl-9" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder="Add tag" /></div><Button variant="secondary" disabled={!tagDraft.trim()} onClick={addTag}><Plus className="size-4" aria-hidden />Add</Button></div></Field>

      {message ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{message}</p> : null}
      <div className="flex justify-end border-t border-border pt-5"><Button disabled={isPending || !canSave} onClick={save}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}{isHandoff ? "Mark ready for editing" : initialAd ? "Save changes" : "Create item"}</Button></div>
    </div>
  );
}
