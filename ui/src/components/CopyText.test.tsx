import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CopyText } from "./CopyText";

describe("CopyText", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders the text", () => {
    render(<CopyText text="Hello World" />);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("copies text to clipboard when clicked", async () => {
    render(<CopyText text="test-copy" />);
    const button = screen.getByRole("button");
    
    await fireEvent.click(button);
    
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test-copy");
    
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
    
    // Wait for the timeout to clear the message
    await waitFor(() => {
      expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows error message when copy fails", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("Failed"));
    
    render(<CopyText text="fail-copy" />);
    const button = screen.getByRole("button");
    
    fireEvent.click(button);
    
    await waitFor(() => {
      expect(screen.getByText("Copy failed")).toBeInTheDocument();
    });
  });
});
