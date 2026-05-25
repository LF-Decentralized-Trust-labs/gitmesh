import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the status label correctly", () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText("in progress")).toBeInTheDocument();
  });

  it("applies the correct CSS classes for a known status", () => {
    const { container } = render(<StatusBadge status="done" />);
    const badge = container.firstChild;
    expect(badge).toHaveClass("font-semibold");
    expect(badge).toHaveTextContent("done");
  });

  it("uses default styling for unknown status", () => {
    render(<StatusBadge status="unknown_status" />);
    expect(screen.getByText("unknown status")).toBeInTheDocument();
  });
});
