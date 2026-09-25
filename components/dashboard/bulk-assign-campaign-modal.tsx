"use client";

import React, { useState, useMemo } from "react";
import { FolderKanban, Loader2, Search, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/field";
import type { AdWithRelations, Campaign } from "@/lib/types";
import { cn } from "@/lib/utils";

export function BulkAssignCampaignModal({
  count,
  campaigns,
  selectedAds = [],
  pending,
  onClose,
  onSubmit
}: {
  count: number;
  campaigns: Campaign[];
  selectedAds?: AdWithRelations[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (campaignId: string) => void;
}) {
  const activeCampaigns = useMemo(
    () => campaigns.filter((c) => c.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [campaigns]
  );

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(activeCampaigns[0]?.id ?? "");
  const [search, setSearch] = useState("");

  const filteredCampaigns = useMemo(() => {
    if (!search.trim()) return activeCampaigns;
    const term = search.toLowerCase();
    return activeCampaigns.filter(
      (c) => c.name.toLowerCase().includes(term) || (c.description && c.description.toLowerCase().includes(term))
    );
  }, [activeCampaigns, search]);

  const targetCampaign = activeCampaigns.find((c) => c.id === selectedCampaignId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampaignId) return;
    onSubmit(selectedCampaignId);
  };

  return (
    <Modal open labelledBy="bulk-assign-campaign-title" onClose={onClose} className="flex items-center justify-center p-4">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-float overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between border-b border-border px-5 py-4 bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-2xs">
              <FolderKanban className="size-5" />
            </div>
            <div>
              <h2 id="bulk-assign-campaign-title" className="text-base font-bold text-foreground">
                Assign {count} Creative{count === 1 ? "" : "s"} to Campaign
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select the destination campaign to reassign the selected creatives.
              </p>
            </div>
          </div>
          <Button size="icon" variant="ghost" className="size-8 rounded-full" title="Close" onClick={onClose}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-4">
            {/* Selected Creatives Preview Chips */}
            {selectedAds.length > 0 ? (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Selected Creatives ({selectedAds.length})</label>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 rounded-lg border border-border bg-muted/20">
                  {selectedAds.slice(0, 6).map((ad) => (
                    <span
                      key={ad.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-card border border-border text-[11px] font-medium text-foreground truncate max-w-[200px]"
                      title={ad.name}
                    >
                      {ad.name}
                    </span>
                  ))}
                  {selectedAds.length > 6 ? (
                    <span className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
                      +{selectedAds.length - 6} more
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Campaign Selection with Search */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">Choose Destination Campaign *</label>
                <span className="text-[11px] text-muted-foreground">{activeCampaigns.length} active campaigns</span>
              </div>

              {activeCampaigns.length > 5 ? (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search campaigns..."
                    className="pl-8 text-xs h-9"
                  />
                </div>
              ) : null}

              <div className="max-h-56 overflow-y-auto rounded-xl border border-border divide-y divide-border bg-muted/10">
                {filteredCampaigns.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    No active campaigns found matching &quot;{search}&quot;.
                  </div>
                ) : (
                  filteredCampaigns.map((camp) => {
                    const isSelected = selectedCampaignId === camp.id;
                    return (
                      <label
                        key={camp.id}
                        className={cn(
                          "flex items-center justify-between p-3 cursor-pointer transition-colors hover:bg-muted/40",
                          isSelected ? "bg-primary/10 border-l-4 border-l-primary" : ""
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <input
                            type="radio"
                            name="campaignSelection"
                            value={camp.id}
                            checked={isSelected}
                            onChange={() => setSelectedCampaignId(camp.id)}
                            className="size-4 text-primary accent-primary shrink-0 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <p className={cn("text-xs font-semibold truncate", isSelected ? "text-primary" : "text-foreground")}>
                              {camp.name}
                            </p>
                            {camp.description ? (
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{camp.description}</p>
                            ) : null}
                          </div>
                        </div>
                        {isSelected ? <Check className="size-4 text-primary shrink-0" /> : null}
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {targetCampaign ? (
              <div className="rounded-lg bg-muted/40 border border-border/80 p-3 text-[11px] text-muted-foreground leading-relaxed">
                Reassigning <strong className="text-foreground">{count}</strong> creative{count === 1 ? "" : "s"} to{" "}
                <strong className="text-foreground">{targetCampaign.name}</strong>. The creatives will appear under this campaign in the Creative Library and Campaign views.
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-border px-5 py-4 bg-muted/20">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !selectedCampaignId}
              className="gap-2 font-semibold min-w-[150px]"
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Assigning...
                </>
              ) : (
                <>
                  <FolderKanban className="size-4" aria-hidden />
                  Assign to Campaign
                </>
              )}
            </Button>
          </div>
        </form>
      </section>
    </Modal>
  );
}
