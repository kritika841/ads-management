"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { CreatorItemForm } from "@/components/workflow/creator-item-form";
import type { AdWithRelations, Campaign, Product, Profile } from "@/lib/types";

export function AdminEditButton({
  ad,
  profile,
  creators,
  editors,
  campaigns,
  products,
  availableTags,
  editorWorkloads,
}: {
  ad: AdWithRelations;
  profile: Profile;
  creators: Profile[];
  editors: Profile[];
  campaigns: Campaign[];
  products: Product[];
  availableTags: string[];
  editorWorkloads: Record<string, number>;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setFormOpen(true)}>
        <Pencil className="size-4" aria-hidden />
        Edit
      </Button>

      {formOpen ? (
        <Modal
          open
          labelledBy="admin-edit-title"
          onClose={() => setFormOpen(false)}
          className="p-0 sm:p-6"
        >
          <section className="mx-auto min-h-full w-full bg-card shadow-float sm:min-h-0 sm:max-w-5xl sm:rounded-xl">
            <div className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-card px-5 sm:rounded-t-lg">
              <div>
                <h2 id="admin-edit-title" className="text-lg font-semibold text-foreground">
                  Override edit creative
                </h2>
                <p className="text-xs text-muted-foreground">
                  Admin/manager override — all fields editable.
                </p>
              </div>
              <Button size="icon" variant="ghost" title="Close" onClick={() => setFormOpen(false)}>
                <X className="size-5" aria-hidden />
              </Button>
            </div>
            <div className="p-5">
              <CreatorItemForm
                profile={profile}
                creators={creators}
                editors={editors}
                campaigns={campaigns}
                products={products}
                initialAd={ad}
                availableTags={availableTags}
                editorWorkloads={editorWorkloads}
                overrideMode={true}
                onSaved={() => {
                  setFormOpen(false);
                  router.refresh();
                }}
              />
            </div>
          </section>
        </Modal>
      ) : null}
    </>
  );
}
