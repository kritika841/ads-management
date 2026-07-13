import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InfoTip } from "@/components/ui/info-tip";

describe("InfoTip", () => {
  it("shows help on focus and tap", () => {
    render(<InfoTip text="Items that need a manager review." />);
    const trigger = screen.getByRole("button", { name: "More information" });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Items that need a manager review.");
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});
