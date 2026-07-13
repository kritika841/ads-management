"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Package, PackagePlus, Pencil, Power, Search, X } from "lucide-react";
import { saveProduct } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ProductsClient({ products }: { products: Product[] }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredProducts = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return products;
    return products.filter((product) => `${product.name} ${product.sku ?? ""}`.toLowerCase().includes(text));
  }, [products, query]);

  const activeCount = products.filter((product) => product.active).length;

  function open(product?: Product) {
    setEditing(product ?? null);
    setName(product?.name ?? "");
    setSku(product?.sku ?? "");
    setImageUrl(product?.image_url ?? "");
    setMessage(null);
    setModalOpen(true);
  }

  function close() {
    setModalOpen(false);
    setEditing(null);
    setMessage(null);
  }

  function persist() {
    setMessage(null);
    startTransition(async () => {
      const response = await saveProduct({
        id: editing?.id,
        name,
        sku,
        imageUrl,
        active: editing?.active ?? true
      });
      if (response.ok) close();
      else setMessage(response.message ?? "Unable to save product.");
    });
  }

  function toggleActive(product: Product) {
    setMessage(null);
    startTransition(async () => {
      const response = await saveProduct({
        id: product.id,
        name: product.name,
        sku: product.sku ?? undefined,
        imageUrl: product.image_url ?? undefined,
        active: !product.active
      });
      if (!response.ok) setMessage(response.message ?? "Unable to update product.");
    });
  }

  return (
    <main className="page-container">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Products</h1>
          <p className="mt-1 text-sm text-slate-500">The product catalog creatives get made for.</p>
        </div>
        <Button onClick={() => open()} className="w-full sm:w-auto">
          <PackagePlus className="size-4" aria-hidden />
          Add product
        </Button>
      </div>

      <section className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <div className="bg-white px-4 py-4">
          <p className="text-xs font-medium text-slate-500">Total products</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{products.length}</p>
        </div>
        <div className="bg-white px-4 py-4">
          <p className="text-xs font-medium text-slate-500">Active</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{activeCount}</p>
        </div>
      </section>

      <section className="panel mt-4 overflow-hidden">
        <div className="border-b border-border p-3">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" />
          </div>
        </div>
        {message && !modalOpen ? <div className="border-b border-border bg-slate-50 px-4 py-2 text-sm text-slate-700">{message}</div> : null}

        {filteredProducts.length ? (
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {filteredProducts.map((product) => (
              <div key={product.id} className={cn("flex items-center gap-3 bg-white p-4", !product.active && "bg-slate-50/60")}>
                <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-slate-50">
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.image_url} alt={product.name} className="size-full object-cover" />
                  ) : (
                    <Package className="size-5 text-slate-300" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-950">{product.name}</p>
                  <p className="truncate text-xs text-slate-500">{product.sku || "No SKU"}</p>
                  <span className={cn("mt-1 inline-flex items-center gap-1.5 text-xs font-medium", product.active ? "text-emerald-700" : "text-slate-400")}>
                    <span className={cn("size-1.5 rounded-full", product.active ? "bg-emerald-500" : "bg-slate-300")} />
                    {product.active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon" variant="ghost" className="size-9" title="Edit product" onClick={() => open(product)}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-9" title={product.active ? "Deactivate product" : "Activate product"} onClick={() => toggleActive(product)}>
                    <Power className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <Package className="size-6 text-slate-300" aria-hidden />
            <p className="mt-3 text-sm font-medium text-slate-700">No products found</p>
            <p className="mt-1 text-xs text-slate-500">Add a product so creatives can be linked to it.</p>
          </div>
        )}
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-0 backdrop-blur-[2px] sm:p-6" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
          <section className="mx-auto min-h-full w-full bg-white shadow-float sm:min-h-0 sm:max-w-lg sm:rounded-lg">
            <div className="flex h-16 items-center justify-between border-b border-border px-5">
              <div>
                <h2 id="product-modal-title" className="text-lg font-semibold text-slate-950">{editing ? "Edit product" : "Add product"}</h2>
                <p className="text-xs text-slate-500">{editing ? "Update the product details" : "Add a product to the catalog"}</p>
              </div>
              <Button size="icon" variant="ghost" title="Close" onClick={close}>
                <X className="size-5" aria-hidden />
              </Button>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Product name" hint="Required."><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus required /></Field>
              <Field label="SKU / handle" hint="Optional"><Input value={sku} onChange={(event) => setSku(event.target.value)} placeholder="e.g. oudh-refill-pack" /></Field>
              <Field label="Image URL" hint="Optional"><Input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." /></Field>
              {message ? <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button disabled={isPending || !name.trim()} onClick={persist}>
                {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {editing ? "Save changes" : "Add product"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
