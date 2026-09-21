import { describe, expect, it } from "vitest";
import { creativeMetaTag, matchAdFlowCreative, selectProductCampaign } from "@/lib/incentive-auto-match";

const ad = { id: "05d25162-237e-4486-95e9-b88bf05bc22c", name: "TAM0164", product_id: "product-1", creator_id: "creator-1", editor_id: "editor-1" };

describe("incentive creative auto matching", () => {
  it("matches a distinct AdFlow creative tag inside a Meta ad name", () => {
    expect(matchAdFlowCreative("OPEN - TAM0164 - Scale", null, [ad])?.ad.id).toBe(ad.id);
  });

  it("matches the explicit collision-safe AdFlow UUID tag", () => {
    const tag = creativeMetaTag(ad, "Tamanna");
    expect(tag).toContain("TAM0164 | Tamanna | AFLOW:");
    expect(matchAdFlowCreative(tag, null, [ad])?.source).toBe("explicit_id");
  });

  it("does not guess from short generic or duplicate tags", () => {
    expect(matchAdFlowCreative("Ad 1", null, [{ ...ad, name: "1" }])).toBeNull();
    expect(matchAdFlowCreative("TAM0164", null, [ad, { ...ad, id: "15d25162-237e-4486-95e9-b88bf05bc22c" }])).toBeNull();
  });

  it("only selects one active product campaign covering the launch date", () => {
    const campaign = { id: "campaign-1", product_id: "product-1", starts_on: "2026-09-01", ends_on: null, active: true };
    expect(selectProductCampaign([campaign], "product-1", "2026-09-15")?.id).toBe(campaign.id);
    expect(selectProductCampaign([campaign, { ...campaign, id: "campaign-2" }], "product-1", "2026-09-15")).toBeNull();
  });
});
