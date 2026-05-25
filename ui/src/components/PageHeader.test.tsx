import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the title", () => {
    render(<PageHeader title="Overview" />);
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });

  it("renders eyebrow and description", () => {
    render(
      <PageHeader 
        title="Settings" 
        eyebrow="Configuration" 
        description="Manage your project" 
      />
    );
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Manage your project")).toBeInTheDocument();
  });

  it("renders meta information within description", () => {
    render(
      <PageHeader 
        title="Project" 
        description="Details" 
        meta="v1.0" 
      />
    );
    expect(screen.getByText(/v1\.0/)).toBeInTheDocument();
  });

  it("renders actions", () => {
    render(
      <PageHeader 
        title="Dashboard" 
        actions={<button>Click Me</button>} 
      />
    );
    expect(screen.getByRole("button", { name: /click me/i })).toBeInTheDocument();
  });
});
