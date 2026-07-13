import { describe, expect, it } from "vitest";
import { sanitizeScriptHtml } from "@/lib/sanitize";

describe("script HTML sanitization", () => {
  it("preserves supported formatting and removes executable markup", () => {
    const result = sanitizeScriptHtml(
      '<p onclick="alert(1)"><strong>Keep</strong><script>alert(2)</script><img src=x onerror=alert(3)></p>'
    );

    expect(result).toBe("<p><strong>Keep</strong></p>");
  });
});
