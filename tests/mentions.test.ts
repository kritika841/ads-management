import { describe, expect, it } from "vitest";
import { extractMentions, profileMentionHandles } from "@/lib/mentions";

describe("extractMentions", () => {
  it("deduplicates lowercase mentions", () => {
    expect(extractMentions("@Avery please check with @avery and @sam.lee")).toEqual(["avery", "sam.lee"]);
  });
});

describe("profile mention handles", () => {
  it("supports both the email prefix and normalized display name", () => {
    expect(profileMentionHandles({ name: "User Two", email: "creator@example.com" })).toEqual([
      "creator",
      "usertwo"
    ]);
  });
});
