"use client";

import { useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { bulkImportCreatives, type BulkImportRowResult } from "@/app/actions/campaign-import";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { MAX_IMPORT_ROWS, importTemplateCsv, parseCreativeImport, resolveImportRows } from "@/lib/campaign-import";
import { runServerAction } from "@/lib/client-action";
import { eligibleCreatorsFor } from "@/lib/creators";
import type { Product, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

const stageOptions = [
  { value: "script_writing", label: "Writing script" },
  { value: "ready_to_shoot", label: "Scripting done" }
] as const;

export function BulkImportCreativesModal({
  campaignId,
  campaignName,
  profile,
  creators,
  products,
  onClose,
  onImported
}: {
  campaignId: string;
  campaignName: string;
  profile: Profile;
  creators: Profile[];
  products: Product[];
  onClose: () => void;
  onImported: () => void;
}) {
  const eligibleCreators = useMemo(() => eligibleCreatorsFor(profile, creators), [profile, creators]);
  const [text, setText] = useState("");
  const [defaultProductId, setDefaultProductId] = useState(products[0]?.id ?? "");
  const [defaultCreatorId, setDefaultCreatorId] = useState(eligibleCreators[0]?.id ?? "");
  const [stage, setStage] = useState<(typeof stageOptions)[number]["value"]>("script_writing");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ created: number; failed: number; results: BulkImportRowResult[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseCreativeImport(text), [text]);
  const rows = useMemo(
    () => resolveImportRows(parsed.rows, {
      products: products.map((item) => ({ id: item.id, name: item.name })),
      creators: eligibleCreators.map((item) => ({ id: item.id, name: item.name, email: item.email })),
      defaultProductId,
      defaultCreatorId
    }),
    [parsed.rows, products, eligibleCreators, defaultProductId, defaultCreatorId]
  );
  const tooMany = rows.length > MAX_IMPORT_ROWS;
  const ready = rows.filter((row) => row.errors.length === 0);
  const productName = (id: string) => products.find((item) => item.id === id)?.name ?? "—";
  const creatorName = (id: string) => eligibleCreators.find((item) => item.id === id)?.name ?? "—";

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) { setError("That file is too large. Keep imports under 1 MB."); return; }
    setError(null);
    setText(await file.text());
    if (fileRef.current) fileRef.current.value = "";
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([importTemplateCsv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "creative-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function runImport() {
    if (!ready.length || tooMany) return;
    setPending(true);
    setError(null);
    const response = await runServerAction(() => bulkImportCreatives({
      campaignId,
      stage,
      rows: ready.map((row) => ({ line: row.line, name: row.name, scriptText: row.scriptText, productId: row.productId, creatorId: row.creatorId, platforms: row.platforms, tags: row.tags, notes: row.notes }))
    }));
    setPending(false);
    if (response.results?.length) {
      setOutcome({ created: response.created ?? 0, failed: response.failed ?? 0, results: response.results });
      if ((response.created ?? 0) > 0) onImported();
    } else {
      setError(response.message ?? "Import failed.");
    }
  }

  return (
    <Modal open labelledBy="bulk-import-title" onClose={() => { if (!pending) onClose(); }} className="p-0 sm:p-6">
      <section className="mx-auto flex min-h-full w-full flex-col bg-card shadow-float sm:min-h-0 sm:max-w-4xl sm:rounded-xl">
        <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-card px-5 sm:rounded-t-xl">
          <h2 id="bulk-import-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FileSpreadsheet className="size-4 text-primary" aria-hidden />
            Bulk import into {campaignName}
          </h2>
          <Button size="icon" variant="ghost" title="Close" disabled={pending} onClick={onClose}><X className="size-4" /></Button>
        </div>

        {outcome ? (
          <div className="space-y-4 p-5">
            <div className={cn("flex items-start gap-3 rounded-lg border p-4", outcome.failed ? "border-warning/30 bg-warning/10" : "border-success/30 bg-success/10")}>
              {outcome.failed ? <AlertCircle className="mt-0.5 size-5 text-warning" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-5 text-success" aria-hidden />}
              <div>
                <p className="text-sm font-semibold text-foreground">{outcome.created} imported{outcome.failed ? `, ${outcome.failed} failed` : ""}</p>
                <p className="text-xs text-muted-foreground">Imported creatives are now in this campaign and in the Creative library.</p>
              </div>
            </div>
            {outcome.failed ? (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
                {outcome.results.filter((item) => !item.ok).map((item) => (
                  <li key={item.line} className="rounded-md border border-border bg-background px-3 py-2"><span className="font-medium text-foreground">Row {item.line}{item.name ? ` · ${item.name}` : ""}:</span> <span className="text-destructive">{item.message}</span></li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Default product" hint="Used when a row has no product.">
                <Select id="import-default-product" value={defaultProductId} onChange={(event) => setDefaultProductId(event.target.value)}>
                  {products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </Field>
              <Field label="Default creator" hint="Used when a row has no creator.">
                <Select id="import-default-creator" value={defaultCreatorId} onChange={(event) => setDefaultCreatorId(event.target.value)} disabled={eligibleCreators.length <= 1}>
                  {eligibleCreators.map((item) => <option key={item.id} value={item.id}>{item.name}{item.id === profile.id ? " (you)" : item.role === "manager" ? " (manager)" : ""}</option>)}
                </Select>
              </Field>
              <Field label="Initial status" hint="Applied to every imported creative.">
                <Select id="import-stage" value={stage} onChange={(event) => setStage(event.target.value as typeof stage)}>
                  {stageOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </Select>
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">Creatives (up to {MAX_IMPORT_ROWS})</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={downloadTemplate}><Download className="size-3.5" aria-hidden />Template</Button>
                  <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="size-3.5" aria-hidden />Upload CSV</Button>
                  <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(event) => void readFile(event.target.files?.[0])} />
                </div>
              </div>
              <Textarea
                id="import-data"
                className="min-h-40 font-mono text-xs"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={"name,script,product,creator,platforms,tags,notes\nHook test 1,\"Opening line… offer…\",Serum,Cara,Meta Ads;Youtube Ads,hook;ugc,\n\nOr paste one script per line, or copy rows straight from a spreadsheet."}
              />
              <p className="text-xs text-muted-foreground">
                Columns: <code>name</code> (optional — auto-generated if blank), <code>script</code> (required), <code>product</code>, <code>creator</code>, <code>platforms</code>, <code>tags</code> (separate multiple values with <code>;</code>), <code>notes</code>.
              </p>
            </div>

            {rows.length ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{ready.length}</span> ready
                  {rows.length - ready.length ? <> · <span className="font-medium text-destructive">{rows.length - ready.length}</span> with problems (skipped)</> : null}
                  {tooMany ? <span className="ml-2 text-destructive">Too many rows — split into batches of {MAX_IMPORT_ROWS}.</span> : null}
                </p>
                <div className="max-h-72 overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="sticky top-0 bg-muted uppercase text-muted-foreground">
                      <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Script</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Creator</th><th className="px-3 py-2">Check</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => (
                        <tr key={row.line} className={row.errors.length ? "bg-destructive/5" : undefined}>
                          <td className="px-3 py-2 text-muted-foreground">{row.line}</td>
                          <td className="px-3 py-2 font-medium text-foreground">{row.name || <span className="font-normal italic text-muted-foreground">auto</span>}</td>
                          <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground" title={row.scriptText}>{row.scriptText || "—"}</td>
                          <td className="px-3 py-2">{productName(row.productId)}</td>
                          <td className="px-3 py-2">{creatorName(row.creatorId)}</td>
                          <td className="px-3 py-2">{row.errors.length ? <span className="text-destructive">{row.errors.join(" ")}</span> : <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-3.5" aria-hidden />Ready</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="secondary" disabled={pending} onClick={onClose}>Cancel</Button>
              <Button id="bulk-import-submit" disabled={pending || !ready.length || tooMany} onClick={runImport}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                {pending ? "Importing…" : `Import ${ready.length || ""} creative${ready.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}
      </section>
    </Modal>
  );
}
