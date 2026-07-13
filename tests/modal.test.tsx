import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "@/components/ui/modal";

function Example() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open</button>{open ? <Modal open labelledBy="modal-title" onClose={() => setOpen(false)}><section><h2 id="modal-title">Example dialog</h2><button>Inside</button></section></Modal> : null}</>;
}

describe("Modal", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
  });

  it("locks scrolling, closes on Escape, and returns focus", () => {
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("closes when the backdrop itself is clicked", () => {
    render(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
