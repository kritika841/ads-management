export function extractMentions(body: string) {
  const matches = body.matchAll(/@([a-zA-Z0-9._-]+)/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1].toLowerCase())));
}

export function profileMentionHandles(profile: { name: string; email: string }) {
  const emailHandle = profile.email.split("@")[0]?.toLowerCase();
  const nameHandle = profile.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "");
  return Array.from(new Set([emailHandle, nameHandle].filter(Boolean)));
}
