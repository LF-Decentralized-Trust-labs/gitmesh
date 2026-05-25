import { describe, it, expect } from "vitest";
import { 
  formatCents, 
  formatDate, 
  formatDateTime, 
  relativeTime, 
  formatTokens, 
  issueUrl, 
  agentRouteRef, 
  agentUrl, 
  subprojectRouteRef, 
  subprojectUrl 
} from "../lib/utils";

describe("formatCents", () => {
  it("formats cents to USD string", () => {
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(50)).toBe("$0.50");
    expect(formatCents(1234)).toBe("$12.34");
    expect(formatCents(0)).toBe("$0.00");
  });
});

describe("formatDate", () => {
  it("formats date to short US style", () => {
    const date = new Date("2024-05-24T12:00:00Z");
    // toLocaleDateString depends on locale, but test uses "en-US" explicitly in utils.ts
    expect(formatDate(date)).toBe("May 24, 2024");
  });
});

describe("formatDateTime", () => {
  it("formats date and time to US style", () => {
    const date = new Date("2024-05-24T14:30:00Z");
    // We expect something like "May 24, 2024, 2:30 PM" (depending on runner timezone, but hour: "numeric" and minute: "2-digit" are set)
    const result = formatDateTime(date);
    expect(result).toContain("May 24, 2024");
    expect(result).toMatch(/\d+:\d+/);
  });
});

describe("formatTokens", () => {
  it("formats numbers with k and M suffixes", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(1000000)).toBe("1.0M");
    expect(formatTokens(2500000)).toBe("2.5M");
  });
});

describe("issueUrl", () => {
  it("prefers identifier over id", () => {
    expect(issueUrl({ id: "123", identifier: "PROJ-1" })).toBe("/issues/PROJ-1");
  });

  it("falls back to id if identifier is missing", () => {
    expect(issueUrl({ id: "123" })).toBe("/issues/123");
    expect(issueUrl({ id: "123", identifier: null })).toBe("/issues/123");
  });
});

describe("agentUrl", () => {
  it("uses urlKey if available", () => {
    expect(agentUrl({ id: "1", urlKey: "my-agent" })).toBe("/agents/my-agent");
  });

  it("derives urlKey from name and id if urlKey is missing", () => {
    // deriveAgentUrlKey("My Agent", "1") -> "my-agent-1" (assuming standard derivation)
    const url = agentUrl({ id: "1", name: "My Agent" });
    expect(url).toContain("/agents/");
    expect(url).toContain("my-agent");
  });
});

describe("subprojectUrl", () => {
  it("uses urlKey if available", () => {
    expect(subprojectUrl({ id: "1", urlKey: "my-subproject" })).toBe("/projects/my-subproject");
  });

  it("derives urlKey from name and id if urlKey is missing", () => {
    const url = subprojectUrl({ id: "1", name: "My Subproject" });
    expect(url).toContain("/projects/");
    expect(url).toContain("my-subproject");
  });
});
