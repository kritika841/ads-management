import { beforeEach, describe, expect, it, vi } from "vitest";
import { runServerAction, runServerMutation } from "@/lib/client-action";

describe("client Server Action handling", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns normal action results", async () => {
    await expect(runServerAction(async () => ({ ok: true as const }))).resolves.toEqual({ ok: true });
  });

  it("converts ordinary failures to a displayable result", async () => {
    await expect(runServerAction(async () => { throw new Error("Network unavailable"); })).resolves.toEqual({ ok: false, message: "Network unavailable" });
  });

  it("contains notification mutation failures", async () => {
    await expect(runServerMutation(async () => { throw new Error("Network unavailable"); })).resolves.toBe(false);
  });
});
