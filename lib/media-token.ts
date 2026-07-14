import { createHmac, timingSafeEqual } from "node:crypto";

const defaultLifetimeSeconds = 30 * 60;

function signingSecret(explicitSecret?: string) {
  const secret = explicitSecret ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Media signing secret is not configured.");
  return secret;
}

function signature(adId: string, fileId: string, expiresAt: number, secret?: string) {
  return createHmac("sha256", signingSecret(secret))
    .update(`${adId}:${fileId}:${expiresAt}`)
    .digest("base64url");
}

export function createMediaAccessToken(
  adId: string,
  fileId: string,
  options: { expiresAt?: number; secret?: string } = {}
) {
  const expiresAt = options.expiresAt ?? Math.floor(Date.now() / 1000) + defaultLifetimeSeconds;
  return `${expiresAt}.${signature(adId, fileId, expiresAt, options.secret)}`;
}

export function verifyMediaAccessToken(
  token: string | null,
  adId: string,
  fileId: string,
  options: { now?: number; secret?: string } = {}
) {
  if (!token) return false;
  const [rawExpiry, suppliedSignature, extra] = token.split(".");
  if (!rawExpiry || !suppliedSignature || extra) return false;

  const expiresAt = Number(rawExpiry);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now) return false;

  const expected = Buffer.from(signature(adId, fileId, expiresAt, options.secret));
  const supplied = Buffer.from(suppliedSignature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
