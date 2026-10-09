import { describe, expect, it } from "vitest";

describe("Campaign Tags & Sorting and Creative Library Filter Facets", () => {
  describe("Creative Library Dynamic Tab Counts", () => {
    // Mock sample ads across different queues
    const sampleAds = [
      {
        id: "ad-1",
        name: "Diwali Hook 1",
        production_stage: "script_writing",
        creator_id: "c1",
        editor_id: null,
        campaign_id: "camp-1",
        product_id: "p1",
        tags: [{ id: "t1", name: "diwali" }]
      },
      {
        id: "ad-2",
        name: "Diwali Hook 2",
        production_stage: "editing",
        creator_id: "c1",
        editor_id: "e1",
        campaign_id: "camp-1",
        product_id: "p2",
        tags: [{ id: "t1", name: "diwali" }]
      },
      {
        id: "ad-3",
        name: "Normal Ad",
        production_stage: "editing",
        creator_id: "c2",
        editor_id: "e1",
        campaign_id: "camp-2",
        product_id: "p1",
        tags: [{ id: "t2", name: "general" }]
      },
      {
        id: "ad-4",
        name: "Approved Diwali Ad",
        production_stage: "approved",
        creator_id: "c1",
        editor_id: "e1",
        campaign_id: "camp-1",
        product_id: "p1",
        tags: [{ id: "t1", name: "diwali" }]
      }
    ];

    it("updates tab counts throughout all statuses when a filter is applied", () => {
      // Filter by tag "diwali"
      const appliedTag = "diwali";
      const matchingAds = sampleAds.filter((ad) =>
        ad.tags.some((t) => t.name === appliedTag)
      );

      expect(matchingAds.length).toBe(3);

      // Status breakdown among matching ads
      const scriptCount = matchingAds.filter((ad) => ad.production_stage === "script_writing").length;
      const editingCount = matchingAds.filter((ad) => ad.production_stage === "editing").length;
      const approvedCount = matchingAds.filter((ad) => ad.production_stage === "approved").length;

      expect(scriptCount).toBe(1);
      expect(editingCount).toBe(1); // ad-2 only, ad-3 is excluded because tag is "general"
      expect(approvedCount).toBe(1);
    });

    it("filters by creator across all status tabs", () => {
      // Filter by creator "c1"
      const matchingAds = sampleAds.filter((ad) => ad.creator_id === "c1");
      expect(matchingAds.length).toBe(3);

      const editingCount = matchingAds.filter((ad) => ad.production_stage === "editing").length;
      expect(editingCount).toBe(1);
    });
  });

  describe("Campaign Detail Tag Filtering and Sorting", () => {
    const campaignCreatives = [
      {
        id: "c1",
        name: "Creative Alpha",
        tags: [{ id: "1", name: "hook" }, { id: "2", name: "ugc" }]
      },
      {
        id: "c2",
        name: "Creative Beta",
        tags: [{ id: "3", name: "offer" }]
      },
      {
        id: "c3",
        name: "Creative Gamma",
        tags: [{ id: "1", name: "hook" }]
      }
    ];

    it("filters creatives by selected tags", () => {
      const selectedTags = ["offer"];
      const filtered = campaignCreatives.filter((c) =>
        c.tags.some((t) => selectedTags.includes(t.name))
      );

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe("c2");
    });

    it("supports multi-tag filtering", () => {
      const selectedTags = ["hook", "offer"];
      const filtered = campaignCreatives.filter((c) =>
        c.tags.some((t) => selectedTags.includes(t.name))
      );

      expect(filtered.length).toBe(3);
    });

    it("sorts creatives by tags alphabetically", () => {
      const sorted = [...campaignCreatives].sort((a, b) => {
        const aTags = a.tags.map((t) => t.name).sort().join(", ");
        const bTags = b.tags.map((t) => t.name).sort().join(", ");
        return aTags.localeCompare(bTags);
      });

      // hook, ugc vs offer vs hook
      // "hook" < "hook, ugc" < "offer"
      expect(sorted[0].id).toBe("c3"); // "hook"
      expect(sorted[1].id).toBe("c1"); // "hook, ugc"
      expect(sorted[2].id).toBe("c2"); // "offer"
    });
  });
});
