import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const requiredTokens = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "muted", "muted-foreground", "accent", "accent-foreground", "primary", "primary-foreground",
  "destructive", "destructive-foreground", "success", "success-foreground", "warning",
  "warning-foreground", "border", "input", "ring"
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx|css)$/.test(name) ? [path] : [];
  });
}

describe("semantic themes", () => {
  const globals = readFileSync("app/globals.css", "utf8");

  it("defines every surface and state token in light and dark themes", () => {
    const dark = globals.slice(globals.indexOf(".dark {"));
    for (const token of requiredTokens) {
      expect(globals).toContain(`--${token}:`);
      expect(dark).toContain(`--${token}:`);
    }
  });

  it("does not use light-only slate surfaces or fixed status palettes", () => {
    const source = sourceFiles("app").concat(sourceFiles("components")).map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toMatch(/(?:bg-white|text-slate-|bg-slate-|border-slate-)/);
    expect(source).not.toMatch(/(?:bg|text|border)-(?:emerald|amber|orange|rose|sky|cyan|blue|indigo|teal)-/);
  });

  it("uses class-based dark mode and a pre-hydration theme bootstrap", () => {
    expect(readFileSync("tailwind.config.ts", "utf8")).toContain('darkMode: "class"');
    expect(readFileSync("app/layout.tsx", "utf8")).toContain("prefers-color-scheme: dark");
  });
});
