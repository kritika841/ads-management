import { platforms as knownPlatforms } from "@/lib/constants";

/**
 * Bulk import of creatives into a campaign: parse pasted / uploaded CSV (or
 * spreadsheet-pasted TSV), then resolve product / creator names to ids. Pure so it
 * can be unit tested and used on both the client preview and the server.
 */

export const MAX_IMPORT_ROWS = 50;

export const importTemplateCsv =
  "name,script,product,creator,platforms,tags,notes\n" +
  "\"Hook test 1\",\"Opening line… then offer…\",\"Product name\",\"Creator name\",\"Meta Ads;Youtube Ads\",\"hook;ugc\",\"Optional note\"\n";

export type ImportColumn = "name" | "script" | "product" | "creator" | "platforms" | "tags" | "notes";

const headerAliases: Record<ImportColumn, string[]> = {
  name: ["name", "adname", "creativename", "title", "creative", "ad"],
  script: ["script", "scripttext", "copy", "brief", "description"],
  product: ["product", "productname"],
  creator: ["creator", "contentcreator", "creatorname", "creatoremail", "owner"],
  platforms: ["platform", "platforms"],
  tags: ["tag", "tags"],
  notes: ["note", "notes", "comments", "comment"]
};

const positionalColumns: ImportColumn[] = ["name", "script", "product", "creator", "platforms", "tags", "notes"];

export type ParsedImportRow = {
  /** 1-based line within the pasted data (header excluded) for error messages. */
  line: number;
  name: string;
  script: string;
  product: string;
  creator: string;
  platforms: string[];
  tags: string[];
  notes: string;
};

/** RFC-4180-ish parser: quoted fields, escaped quotes and embedded newlines. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === "\"") {
        if (input[i + 1] === "\"") { field += "\""; i += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === "\"" && field === "") quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += char;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  if (firstLine.includes("\t")) return "\t";
  return ",";
}

const normaliseHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const splitList = (value: string) => Array.from(new Set(value.split(/[;|,]/).map((item) => item.trim()).filter(Boolean)));

export function parseCreativeImport(text: string): { rows: ParsedImportRow[]; hadHeader: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { rows: [], hadHeader: false };
  const delimiter = detectDelimiter(trimmed);
  let grid = parseDelimited(trimmed, delimiter);
  if (!grid.length) return { rows: [], hadHeader: false };

  const headerMap = new Map<number, ImportColumn>();
  grid[0].forEach((cell, index) => {
    const key = normaliseHeader(cell);
    const column = (Object.keys(headerAliases) as ImportColumn[]).find((candidate) => headerAliases[candidate].includes(key));
    if (column && ![...headerMap.values()].includes(column)) headerMap.set(index, column);
  });
  const hadHeader = [...headerMap.values()].some((column) => column === "name" || column === "script");
  // Without a header row, comma-separated text is far more likely to be prose scripts than
  // columns, so keep each non-empty line whole as a script instead of splitting on commas.
  if (!hadHeader && delimiter === ",") {
    grid = trimmed.split(/\r?\n/).filter((line) => line.trim()).map((line) => [line]);
  }
  const body = hadHeader ? grid.slice(1) : grid;

  const mapping = new Map<number, ImportColumn>();
  if (hadHeader) headerMap.forEach((column, index) => mapping.set(index, column));
  else if ((grid[0]?.length ?? 0) === 1) mapping.set(0, "script"); // one script per line
  else positionalColumns.forEach((column, index) => mapping.set(index, column));

  const rows = body.map((cells, offset): ParsedImportRow => {
    const value = (column: ImportColumn) => {
      const index = [...mapping.entries()].find(([, mapped]) => mapped === column)?.[0];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };
    return {
      line: offset + 1,
      name: value("name"),
      script: value("script"),
      product: value("product"),
      creator: value("creator"),
      platforms: splitList(value("platforms")),
      tags: splitList(value("tags")),
      notes: value("notes")
    };
  });
  return { rows, hadHeader };
}

export type ImportLookups = {
  products: Array<{ id: string; name: string }>;
  creators: Array<{ id: string; name: string; email?: string | null }>;
  defaultProductId: string;
  defaultCreatorId: string;
};

export type ResolvedImportRow = {
  line: number;
  name: string;
  scriptText: string;
  productId: string;
  creatorId: string;
  platforms: string[];
  tags: string[];
  notes: string;
  /** Empty when the row is ready to import. */
  errors: string[];
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function resolveImportRows(rows: ParsedImportRow[], lookups: ImportLookups): ResolvedImportRow[] {
  const seenNames = new Map<string, number>();
  return rows.map((row) => {
    const errors: string[] = [];
    if (!row.script) errors.push("Script is required.");
    if (row.name.length > 160) errors.push("Name is longer than 160 characters.");

    let productId = lookups.defaultProductId;
    if (row.product) {
      const product = lookups.products.find((item) => same(item.name, row.product));
      if (product) productId = product.id; else errors.push(`Unknown product “${row.product}”.`);
    }
    if (!productId) errors.push("Choose a product (default or in the file).");

    let creatorId = lookups.defaultCreatorId;
    if (row.creator) {
      const creator = lookups.creators.find((item) => same(item.name, row.creator) || (item.email ? same(item.email, row.creator) : false));
      if (creator) creatorId = creator.id; else errors.push(`You can't add creatives for “${row.creator}”.`);
    }
    if (!creatorId) errors.push("Choose a creator.");

    const resolvedPlatforms: string[] = [];
    for (const platform of row.platforms) {
      const match = knownPlatforms.find((item) => same(item, platform));
      if (match) resolvedPlatforms.push(match); else errors.push(`Unknown platform “${platform}”.`);
    }

    if (row.name) {
      const key = row.name.trim().toLowerCase();
      const previous = seenNames.get(key);
      if (previous) errors.push(`Duplicate name (also on line ${previous}).`);
      else seenNames.set(key, row.line);
    }

    return {
      line: row.line,
      name: row.name,
      scriptText: row.script,
      productId,
      creatorId,
      platforms: Array.from(new Set(resolvedPlatforms)),
      tags: row.tags,
      notes: row.notes,
      errors
    };
  });
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain script text → the paragraph HTML the script editor stores. */
export function scriptTextToHtml(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}
