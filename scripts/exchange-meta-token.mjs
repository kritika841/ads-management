import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const required = ["META_ACCESS_TOKEN", "META_APP_ID", "META_APP_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")} in .env.local.`);
  process.exit(1);
}

const url = new URL("https://graph.facebook.com/v23.0/oauth/access_token");
url.searchParams.set("grant_type", "fb_exchange_token");
url.searchParams.set("client_id", process.env.META_APP_ID);
url.searchParams.set("client_secret", process.env.META_APP_SECRET);
url.searchParams.set("fb_exchange_token", process.env.META_ACCESS_TOKEN);

const response = await fetch(url);
const payload = await response.json();
if (!response.ok || !payload.access_token) {
  console.error(payload.error?.message ?? `Meta returned HTTP ${response.status}.`);
  process.exit(1);
}

const current = await fs.readFile(envPath, "utf8");
const line = `META_ACCESS_TOKEN=${payload.access_token}`;
const updated = /^META_ACCESS_TOKEN=.*$/m.test(current)
  ? current.replace(/^META_ACCESS_TOKEN=.*$/m, line)
  : `${current.trimEnd()}\n\n${line}\n`;
await fs.writeFile(envPath, updated, { mode: 0o600 });

const expiry = payload.expires_in
  ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
  : "not returned by Meta";
console.log(`Long-lived Meta token saved to .env.local. Expiry: ${expiry}`);

