import { describe, expect, it, vi } from "vitest";
import { createAdapterRegistry, type AgentAdapter } from "./index.js";

function dummyAdapter(name: string): AgentAdapter {
  return {
    name,
    version: "0.0.0",
    detect: () => [],
    importArtifacts: () => ({}),
    capabilities: () => ({}),
    plan: () => [],
    emit: () => [],
    fixtures: [],
  };
}

describe("createAdapterRegistry", () => {
  it("lists the built-in adapters by default", () => {
    const registry = createAdapterRegistry();
    expect(registry.list()).toEqual(["claude-code", "codex", "copilot", "cursor"]);
  });

  it("lists 0 adapters for an empty loader map", () => {
    const registry = createAdapterRegistry(new Map());
    expect(registry.list()).toEqual([]);
  });

  it("lazily loads the built-in claude-code adapter", async () => {
    const registry = createAdapterRegistry();
    const adapter = await registry.load("claude-code");
    expect(adapter.name).toBe("claude-code");
    expect(typeof adapter.detect).toBe("function");
    await expect(registry.load("claude-code")).resolves.toBe(adapter);
  });

  it("lists registered adapters sorted by name", () => {
    const registry = createAdapterRegistry(new Map());
    registry.register("codex", async () => dummyAdapter("codex"));
    registry.register("claude-code", async () => dummyAdapter("claude-code"));
    expect(registry.list()).toEqual(["claude-code", "codex"]);
    expect(registry.has("codex")).toBe(true);
    expect(registry.has("cursor")).toBe(false);
  });

  it("loads lazily and invokes the loader at most once", async () => {
    const registry = createAdapterRegistry(new Map());
    const loader = vi.fn(async () => dummyAdapter("claude-code"));
    registry.register("claude-code", loader);
    expect(loader).not.toHaveBeenCalled();

    const first = await registry.load("claude-code");
    const second = await registry.load("claude-code");
    expect(first.name).toBe("claude-code");
    expect(second).toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed load instead of caching the rejection", async () => {
    const registry = createAdapterRegistry(new Map());
    let attempts = 0;
    registry.register("claude-code", async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("transient load failure");
      }
      return dummyAdapter("claude-code");
    });

    await expect(registry.load("claude-code")).rejects.toThrow(
      "transient load failure",
    );
    const adapter = await registry.load("claude-code");
    expect(adapter.name).toBe("claude-code");
    expect(attempts).toBe(2);
  });

  it("rejects loading an unknown adapter", async () => {
    const registry = createAdapterRegistry();
    await expect(registry.load("nope")).rejects.toThrow(
      "Unknown adapter: nope",
    );
  });

  it("rejects duplicate registration", () => {
    const registry = createAdapterRegistry();
    registry.register("gemini", async () => dummyAdapter("gemini"));
    expect(() =>
      registry.register("gemini", async () => dummyAdapter("gemini")),
    ).toThrow("Adapter already registered: gemini");
  });
});
