import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import { Info } from "lucide-react";

describe("EmptyState", () => {
  it("renders the message and description", () => {
    render(<EmptyState icon={Info} message="No items" description="Check back later" />);
    
    expect(screen.getByText("No items")).toBeInTheDocument();
    expect(screen.getByText("Check back later")).toBeInTheDocument();
  });

  it("renders and handles the action button", () => {
    const onAction = vi.fn();
    render(
      <EmptyState 
        icon={Info} 
        message="No items" 
        action="Add Item" 
        onAction={onAction} 
      />
    );
    
    const button = screen.getByText("Add Item");
    expect(button).toBeInTheDocument();
    
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders the eyebrow when provided", () => {
    render(<EmptyState icon={Info} message="No items" eyebrow="Wait!" />);
    expect(screen.getByText("Wait!")).toBeInTheDocument();
  });
});
