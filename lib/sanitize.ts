import sanitizeHtml from "sanitize-html";

const scriptTags = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "s",
  "strike",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "code",
  "pre",
  "hr"
];

export function sanitizeScriptHtml(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return sanitizeHtml(value, {
    allowedTags: scriptTags,
    allowedAttributes: {},
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true
  });
}

export function scriptTextToHtml(text: string | null | undefined): string {
  if (!text || !text.trim()) {
    return "";
  }

  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/);

  const rawHtml = paragraphs
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br />")}</p>`)
    .join("");

  return sanitizeScriptHtml(rawHtml);
}

export function resolveScriptHtml(
  scriptHtml: string | null | undefined,
  scriptText?: string | null | undefined
): string {
  const sanitized = sanitizeScriptHtml(scriptHtml);
  if (sanitized && sanitized.replace(/<[^>]+>/g, "").trim()) {
    return sanitized;
  }
  return scriptTextToHtml(scriptText);
}
