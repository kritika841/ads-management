import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSyncState } from "@/lib/sync-state";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  const push = vi.fn();
  const router = { refresh, push };
  const rpc = vi.fn();
  const removeChannel = vi.fn();
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn()
  };
  return { refresh, push, router, rpc, removeChannel, channel };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router
}));

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    rpc: mocks.rpc,
    channel: () => mocks.channel,
    removeChannel: mocks.removeChannel
  })
}));

import { RealtimeSync } from "@/components/realtime-sync";

const baseline: UserSyncState = {
  ads_count: 1,
  ads_latest: "2026-07-10T10:00:00Z",
  new_assignments: 0,
  comments_count: 0,
  comments_latest: null,
  reviews_count: 0,
  reviews_latest: null,
  annotations_count: 0,
  annotations_latest: null,
  activity_count: 1,
  activity_latest: "2026-07-10T10:00:00Z",
  notifications_count: 0,
  notifications_latest: null,
  notifications_unread: 0
};

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("realtime sync fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.refresh.mockReset();
    mocks.push.mockReset();
    mocks.rpc.mockReset().mockResolvedValue({ data: baseline, error: null });
    mocks.removeChannel.mockReset();
    mocks.channel.on.mockReset().mockImplementation(() => mocks.channel);
    mocks.channel.subscribe.mockReset().mockImplementation(() => mocks.channel);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("polls visible tabs, skips unchanged refreshes, and announces a new assignment", async () => {
    render(<RealtimeSync userId="editor-1" role="editor" />);
    await act(flushPromises);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await flushPromises();
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValue({
      data: { ...baseline, ads_count: 2, ads_latest: "2026-07-10T10:05:00Z", new_assignments: 1, notifications_count: 1, notifications_unread: 1 },
      error: null
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await flushPromises();
    });

    expect(screen.getByText("New editing assignment")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "View assignment" }));
    expect(mocks.push).toHaveBeenCalledWith("/library?queue=new_assignments");
  });
});
