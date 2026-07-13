import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/ui/toast";

function Trigger({ onExpire }: { onExpire: () => void }) {
  const { toast } = useToast();
  return <button onClick={() => toast({ title: "Approved", tone: "success", duration: 5_000, action: { label: "Undo", onClick: () => undefined }, onExpire })}>Approve</button>;
}

describe("toast provider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("crypto", { randomUUID: () => "toast-id" });
  });

  it("runs the deferred action when the toast expires", () => {
    const onExpire = vi.fn();
    render(<ToastProvider><Trigger onExpire={onExpire} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText("Approved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    expect(onExpire).toHaveBeenCalledOnce();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
  });

  it("cancels the deferred action when Undo is selected", () => {
    const onExpire = vi.fn();
    render(<ToastProvider><Trigger onExpire={onExpire} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    act(() => vi.advanceTimersByTime(5_000));
    expect(onExpire).not.toHaveBeenCalled();
  });
});
