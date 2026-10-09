import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseServiceAccountCredentials } from "@/lib/google-credentials";

const key = {
  type: "service_account",
  client_email: "bot@example.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nABC\nDEF\n-----END PRIVATE KEY-----\n"
};
const json = JSON.stringify(key);

describe("parseServiceAccountCredentials", () => {
  it("returns null when nothing is configured", () => {
    expect(parseServiceAccountCredentials(undefined)).toBeNull();
    expect(parseServiceAccountCredentials("  ")).toBeNull();
  });

  it("parses plain and quoted JSON", () => {
    expect(parseServiceAccountCredentials(json)).toEqual(key);
    expect(parseServiceAccountCredentials(`'${json}'`)).toEqual(key);
  });

  it("parses the production .env form where dotenv keeps escaped quotes and expands \\n", () => {
    // .env: GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON="{\"type\":...,\"private_key\":\"-----BEGIN...\n...\"}"
    // dotenv leaves `\"` untouched and turns `\n` into real newlines.
    const dotenvValue = json.replace(/"/g, '\\"').replace(/\\n/g, "\n");
    expect(() => JSON.parse(dotenvValue)).toThrow(/position 1/);
    expect(parseServiceAccountCredentials(dotenvValue)).toEqual(key);
  });

  it("parses the form where the .env used double-escaped newlines", () => {
    const value = json.replace(/"/g, '\\"');
    expect(parseServiceAccountCredentials(value)).toEqual(key);
  });

  it("parses base64 and double-encoded JSON", () => {
    expect(parseServiceAccountCredentials(Buffer.from(json).toString("base64"))).toEqual(key);
    expect(parseServiceAccountCredentials(JSON.stringify(json))).toEqual(key);
  });

  it("reads a key file path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sa-"));
    const file = path.join(dir, "key.json");
    writeFileSync(file, json);
    expect(parseServiceAccountCredentials(file)).toEqual(key);
  });

  it("throws a clear error for unusable values", () => {
    expect(() => parseServiceAccountCredentials("{not json")).toThrow(/not valid JSON/);
    expect(() => parseServiceAccountCredentials("/no/such/key.json")).toThrow(/neither JSON/);
  });
});
