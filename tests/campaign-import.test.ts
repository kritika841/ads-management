import { describe, expect, it } from "vitest";
import {
  parseCreativeImport,
  parseDelimited,
  resolveImportRows,
  scriptTextToHtml
} from "@/lib/campaign-import";

const lookups = {
  products: [{ id: "p1", name: "Glow Serum" }],
  creators: [
    { id: "c1", name: "Asha", email: "asha@example.com" },
    { id: "c2", name: "Ravi", email: "ravi@example.com" }
  ],
  defaultProductId: "p1",
  defaultCreatorId: "c1"
};

describe("parseDelimited", () => {
  it("handles quoted fields, escaped quotes and embedded newlines", () => {
    const rows = parseDelimited('a,"b ""q"" c","line1\nline2"\nx,y,z', ",");
    expect(rows).toEqual([
      ["a", 'b "q" c', "line1\nline2"],
      ["x", "y", "z"]
    ]);
  });
});

describe("parseCreativeImport", () => {
  it("maps header aliases from CSV", () => {
    const { rows, hadHeader } = parseCreativeImport(
      'Creative Name,Script,Platforms,Tags\n"Hook 1","Say, hello",Meta Ads;Youtube Ads,hook;ugc'
    );
    expect(hadHeader).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Hook 1",
      script: "Say, hello",
      platforms: ["Meta Ads", "Youtube Ads"],
      tags: ["hook", "ugc"]
    });
  });

  it("treats tab separated data without header as positional columns", () => {
    const { rows, hadHeader } = parseCreativeImport("Ad A\tSome script\tGlow Serum\tRavi");
    expect(hadHeader).toBe(false);
    expect(rows[0]).toMatchObject({ name: "Ad A", script: "Some script", product: "Glow Serum", creator: "Ravi" });
  });

  it("treats headerless comma text as one script per line", () => {
    const { rows } = parseCreativeImport("First, with a comma\nSecond script");
    expect(rows.map((row) => row.script)).toEqual(["First, with a comma", "Second script"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCreativeImport("   ").rows).toEqual([]);
  });
});

describe("resolveImportRows", () => {
  const parse = (text: string) => parseCreativeImport(text).rows;

  it("resolves defaults and names", () => {
    const [row] = resolveImportRows(parse("name,script,product,creator\nA,Body,glow serum,RAVI@example.com"), lookups);
    expect(row.errors).toEqual([]);
    expect(row).toMatchObject({ productId: "p1", creatorId: "c2", scriptText: "Body" });
  });

  it("reports unknown product, creator and platform", () => {
    const [row] = resolveImportRows(
      parse("name,script,product,creator,platforms\nA,Body,Nope,Ghost,Tiktok"),
      lookups
    );
    expect(row.errors).toHaveLength(3);
  });

  it("flags missing script and duplicate names", () => {
    const rows = resolveImportRows(parse("name,script\nA,\nB,Body\nb,Body"), lookups);
    expect(rows[0].errors).toContain("Script is required.");
    expect(rows[1].errors).toEqual([]);
    expect(rows[2].errors.some((error) => error.startsWith("Duplicate name"))).toBe(true);
  });

  it("requires a product when no default exists", () => {
    const [row] = resolveImportRows(parse("Only script"), { ...lookups, defaultProductId: "" });
    expect(row.errors.some((error) => error.includes("product"))).toBe(true);
  });
});

describe("scriptTextToHtml", () => {
  it("escapes html and wraps lines in paragraphs", () => {
    expect(scriptTextToHtml("<b>hi</b> & bye\n\nnext")).toBe("<p>&lt;b&gt;hi&lt;/b&gt; &amp; bye</p><p>next</p>");
  });
});
