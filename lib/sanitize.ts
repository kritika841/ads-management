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
