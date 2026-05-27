import { defineConfig } from "vitest/config";

import { describe, it, expect } from "vitest";
import {extractModelName, extractProviderId, extractProviderIdWithFallback} from "../lib/model-utils"

describe("extractProviderId", () => {
  it("extracts provider ID from model ID", () => {
    expect(extractProviderId("provider/model")).toBe("provider");
  });

  it("returns null if no provider ID is present", () => {
    expect(extractProviderId("model")).toBeNull();
  });

  it("trims whitespace from provider ID", () => {
    expect(extractProviderId("  provider  /model")).toBe("provider");
  });

  it("returns null for empty string", () => {
    expect(extractProviderId("")).toBeNull();
  });
});

describe("extractProviderIdWithFallback", () => {
  it("extracts provider ID from model ID", () => {
    expect(extractProviderIdWithFallback("provider/model")).toBe("provider");
  });

  it("returns fallback if no provider ID is present", () => {
    expect(extractProviderIdWithFallback("model")).toBe("other");
  });

  it("trims whitespace from provider ID", () => {
    expect(extractProviderIdWithFallback("  provider  /model")).toBe("provider");
  });

  it("returns fallback for empty string", () => {
    expect(extractProviderIdWithFallback("")).toBe("other");
  });

  it("allows custom fallback value", () => {
    expect(extractProviderIdWithFallback("model", "default")).toBe("default");
  });
});

describe("extractModelName", () => {
  it("extracts model name from model ID", () => {
    expect(extractModelName("provider/model")).toBe("model");
  });

  it("returns entire string if no provider ID is present", () => {
    expect(extractModelName("model")).toBe("model");
  });

  it("trims whitespace from model name", () => {
    expect(extractModelName("provider/  model  ")).toBe("model");
  });

  it("returns empty string for empty input", () => {
    expect(extractModelName("")).toBe("");
  });
});