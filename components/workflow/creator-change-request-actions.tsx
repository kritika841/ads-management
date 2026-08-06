"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { platforms } from "@/lib/constants";
import type { AdWithRelations, Campaign, Product, Profile } from "@/lib/types";

export function CreatorChangeRequestActions({ ad, editors, workloads, campaigns, products, availableTags }: { ad: AdWithRelations; editors: Profile[]; workloads: Record<string, number>; campaigns: Campaign[]; products: Product[]; availableTags: string[] }) {
  const router = useRouter();
  const [name] = useState(ad.name);
  const [campaignId, setCampaignId] = useState(ad.campaign_id ?? "");
  const [productId, setProductId] = useState(ad.product_id ?? "");
  const [scriptText, setScriptText] = useState(ad.script_text ?? "");
  const [rawFootageUrl, setRawFootageUrl] = useState(ad.raw_footage_url ?? "");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(ad.platforms ?? []);
  const [tags, setTags] = useState<string[]>(ad.tags.map((item) => item.name));
  const [tagDraft, setTagDraft] = useState("");
  const [editorId, setEditorId] = useState("");
  const [deadline, setDeadline] = useState(ad.deadline ?? "");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activeEditors = editors.filter((item) => item.active && item.role === "editor");
  const canSubmit = Boolean(name.trim() && campaignId && productId && scriptText.trim());

  function togglePlatform(value: string) {
    setSelectedPlatforms((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function toggleTag(value: string) {
    setTags((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function addTag() {
    const parsedTags = tagDraft.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!parsedTags.length) return;
    setTags((current) => Array.from(new Set([...current, ...parsedTags])));
    setTagDraft("");
  }

  function send(route: "review" | "editor") {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/ads/resolve-creator-change-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adId: ad.id,
          route,
          editorId,
          deadline,
          note: note || undefined,
          name,
          campaignId,
          productId,
          scriptText,
          rawFootageUrl,
          platforms: selectedPlatforms,
          tags
        })
      });

      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message ?? "Unable to resubmit this creative.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-border p-5">
        <h2 className="section-heading">Resubmit creative</h2>
        <p className="mt-1 text-sm text-muted-foreground">Update anything that needs to change — name, campaign, product, script, or raw footage — then resubmit it for review or send it to an editor.</p>
      </div>
      <div className="space-y-4 p-5">
        <Field label="Ad name" hint="This cannot be changed while the creative is under creator resubmission.">
          <Input value={name} readOnly placeholder="Ad name" />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Campaign">
            <Select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
              <option value="">Choose campaign</option>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </Select>
          </Field>
          <Field label="Product">
            <Select value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">Choose product</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Raw footage folder" hint="Google Drive folder link.">
          <Input value={rawFootageUrl} onChange={(event) => setRawFootageUrl(event.target.value)} placeholder="https://drive.google.com/..." />
        </Field>
        <Field label="Script">
          <Textarea className="min-h-32" value={scriptText} onChange={(event) => setScriptText(event.target.value)} placeholder="Script" />
        </Field>
        <Field label="Platforms">
          <div className="flex flex-wrap gap-2">
            {platforms.map((item) => (
              <button key={item} type="button" onClick={() => togglePlatform(item)} className={`rounded-full border px-3 py-1.5 text-xs ${selectedPlatforms.includes(item) ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground"}`}>
                {item}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Tags">
          <div className="flex flex-wrap gap-2">
            {Array.from(new Set([...availableTags, ...tags])).sort().map((item) => (
              <button key={item} type="button" onClick={() => toggleTag(item)} className={`rounded-full border px-3 py-1.5 text-xs ${tags.includes(item) ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground"}`}>
                #{item}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder="Add new tag" />
            <Button type="button" variant="secondary" disabled={!tagDraft.trim()} onClick={addTag}>Add</Button>
          </div>
        </Field>
        <Field label="Notes" hint="Optional. Add context for reviewers or the editor.">
          <Textarea className="min-h-20" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What changed?" />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Assign editor" hint="Required only if you resubmit to editing.">
            <Select value={editorId} onChange={(event) => setEditorId(event.target.value)}>
              <option value="">Choose editor</option>
              {activeEditors.map((editor) => <option key={editor.id} value={editor.id}>{editor.name} · {workloads[editor.id] ?? 0} assigned</option>)}
            </Select>
          </Field>
          <Field label="Deadline" hint="Required only when assigning an editor.">
            <Input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          </Field>
        </div>
        {message ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{message}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={pending || !canSubmit} onClick={() => send("review")}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            Resubmit for review
          </Button>
          <Button disabled={pending || !canSubmit || !editorId || !deadline.trim()} onClick={() => send("editor")}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserCheck className="size-4" aria-hidden />}
            Resubmit to editor
          </Button>
        </div>
      </div>
    </section>
  );
}