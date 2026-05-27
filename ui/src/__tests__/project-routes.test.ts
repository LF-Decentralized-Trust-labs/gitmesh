import { defineConfig } from "vitest/config";

import { describe, it, expect } from "vitest";
import {
  normalizeProjectPrefix,
  isGlobalPath,
  isBoardPathWithoutPrefix,
  extractProjectPrefixFromPath,
  applyProjectPrefix,
  toProjectRelativePath,
} from "../lib/project-routes.js";

describe("normalizeProjectPrefix", () => {
  it("trims whitespace and converts to uppercase", () => {
    const result = normalizeProjectPrefix("  hello  ");
    expect(result).toBe("HELLO");
  });

  it("handles already uppercase text", () => {
    const result = normalizeProjectPrefix("WORLD");
    expect(result).toBe("WORLD");
  });

  it("handles mixed case", () => {
    const result = normalizeProjectPrefix("MyProject");
    expect(result).toBe("MYPROJECT");
  });
});

describe("isGlobalPath", () => {
  it("returns true for root path /", () => {
    expect(isGlobalPath("/")).toBe(true);
  });

  it("returns true for global routes like /auth", () => {
    expect(isGlobalPath("/auth")).toBe(true);
    expect(isGlobalPath("/invite")).toBe(true);
    expect(isGlobalPath("/docs")).toBe(true);
  });

  it("returns true for nested global paths", () => {
    expect(isGlobalPath("/auth/login")).toBe(true);
    expect(isGlobalPath("/invite/accept")).toBe(true);
  });

  it("returns false for board-only paths like /dashboard", () => {
    expect(isGlobalPath("/dashboard")).toBe(false);
    expect(isGlobalPath("/dashboard/summary")).toBe(false);
  });

  it("returns false for project-prefixed paths", () => {
    expect(isGlobalPath("/MYPROJECT/dashboard")).toBe(false);
  });

  it("returns true for empty/malformed paths", () => {
    expect(isGlobalPath("")).toBe(true);
    expect(isGlobalPath("///")).toBe(true);
  });
});

describe("isBoardPathWithoutPrefix", () => {
  it("returns true for board routes", () => {
    expect(isBoardPathWithoutPrefix("/dashboard")).toBe(true);
    expect(isBoardPathWithoutPrefix("/agents")).toBe(true);
    expect(isBoardPathWithoutPrefix("/issues")).toBe(true);
  });

  it("returns true for nested board paths", () => {
    expect(isBoardPathWithoutPrefix("/dashboard/summary")).toBe(true);
  });

  it("returns false for global routes", () => {
    expect(isBoardPathWithoutPrefix("/auth")).toBe(false);
    expect(isBoardPathWithoutPrefix("/invite")).toBe(false);
  });

  it("returns false for project-prefixed paths", () => {
    expect(isBoardPathWithoutPrefix("/MYPROJECT/dashboard")).toBe(false);
  });

  it("returns false for empty path", () => {
    expect(isBoardPathWithoutPrefix("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isBoardPathWithoutPrefix("/Dashboard")).toBe(true);
    expect(isBoardPathWithoutPrefix("/AGENTS")).toBe(true);
  });
});

describe("extractProjectPrefixFromPath", () => {
  it("extracts project prefix from simple path", () => {
    const result = extractProjectPrefixFromPath("/myproject/dashboard");
    expect(result).toBe("MYPROJECT");
  });

  it("returns null for global routes", () => {
    expect(extractProjectPrefixFromPath("/auth/login")).toBeNull();
    expect(extractProjectPrefixFromPath("/invite/accept")).toBeNull();
  });

  it("returns null for board routes without prefix", () => {
    expect(extractProjectPrefixFromPath("/dashboard")).toBeNull();
    expect(extractProjectPrefixFromPath("/agents")).toBeNull();
  });

  it("returns null for empty path", () => {
    expect(extractProjectPrefixFromPath("")).toBeNull();
  });

  it("normalizes the extracted prefix (trim + uppercase)", () => {
    const result = extractProjectPrefixFromPath("/  myproject  /dashboard");
    expect(result).toBe("MYPROJECT");
  });

  it("handles single segment paths", () => {
    const result = extractProjectPrefixFromPath("/myproject");
    expect(result).toBe("MYPROJECT");
  });
});

describe("applyProjectPrefix", () => {
  it("adds prefix to a simple path", () => {
    const result = applyProjectPrefix("/dashboard", "myproject");
    expect(result).toBe("/MYPROJECT/dashboard");
  });

  it("does not add prefix to global routes", () => {
    expect(applyProjectPrefix("/auth/login", "myproject")).toBe("/auth/login");
    expect(applyProjectPrefix("/invite", "myproject")).toBe("/invite");
  });

  it("does not add prefix if path already has one", () => {
    const result = applyProjectPrefix("/MYPROJECT/dashboard", "otherproject");
    expect(result).toBe("/MYPROJECT/dashboard");
  });

  it("returns unchanged path when prefix is null or undefined", () => {
    expect(applyProjectPrefix("/dashboard", null)).toBe("/dashboard");
    expect(applyProjectPrefix("/dashboard", undefined)).toBe("/dashboard");
  });

  it("preserves query strings and hashes", () => {
    const result = applyProjectPrefix("/dashboard?tab=1#section", "myproject");
    expect(result).toBe("/MYPROJECT/dashboard?tab=1#section");
  });

  it("does not modify non-absolute paths", () => {
    const result = applyProjectPrefix("dashboard", "myproject");
    expect(result).toBe("dashboard");
  });

  it("normalizes the provided prefix", () => {
    const result = applyProjectPrefix("/dashboard", "  myproject  ");
    expect(result).toBe("/MYPROJECT/dashboard");
  });
});

describe("toProjectRelativePath", () => {
  it("removes project prefix from board path", () => {
    const result = toProjectRelativePath("/MYPROJECT/dashboard");
    expect(result).toBe("/dashboard");
  });

  it("removes project prefix and keeps the board route", () => {
    const result = toProjectRelativePath("/myproject/agents/123");
    expect(result).toBe("/agents/123");
  });

  it("preserves query strings and hashes", () => {
    const result = toProjectRelativePath("/myproject/dashboard?tab=1#section");
    expect(result).toBe("/dashboard?tab=1#section");
  });

  it("does not modify global routes", () => {
    expect(toProjectRelativePath("/auth/login")).toBe("/auth/login");
    expect(toProjectRelativePath("/invite")).toBe("/invite");
  });

  it("does not modify board routes without prefix", () => {
    expect(toProjectRelativePath("/dashboard")).toBe("/dashboard");
  });

  it("returns path unchanged if not a recognized pattern", () => {
    expect(toProjectRelativePath("/unknownprefix/something")).toBe(
      "/unknownprefix/something"
    );
  });

  it("handles empty path", () => {
    expect(toProjectRelativePath("")).toBe("");
  });
});