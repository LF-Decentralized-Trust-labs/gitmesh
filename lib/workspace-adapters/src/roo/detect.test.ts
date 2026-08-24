import { describe, expect, it } from "vitest";
import { describeDetectorGoldens, useTempDirs } from "../detect-test-utils.js";
import { detect, rooAdapter } from "./index.js";

describeDetectorGoldens(rooAdapter, "T1.6", (_caseDir, inputRepoDir) => ({
  rootDir: inputRepoDir,
}));

const temp = useTempDirs();

describe("roo detect()", () => {
  it("inventories general and per-mode rules trees plus root fallbacks", () => {
    const root = temp.makeRepo("gitmesh-roo-detect-", {
      ".roo/rules/base.md": "# base\n",
      ".roo/rules/deep/nested.txt": "nested rule\n",
      ".roo/rules-code/style.md": "# code style\n",
      ".roo/other/skip.md": "not a rules dir\n",
      ".roorules": "fallback\n",
      ".roorules-docs": "docs fallback\n",
    });
    expect(detect({ rootDir: root }).map((a) => [a.path, a.kind])).toEqual([
      [".roo/rules-code/style.md", "rule"],
      [".roo/rules/base.md", "rule"],
      [".roo/rules/deep/nested.txt", "rule"],
      [".roorules", "rule"],
      [".roorules-docs", "rule"],
    ]);
  });

  it("inventories modes, ignore, MCP config, commands, and both instruction files", () => {
    const root = temp.makeRepo("gitmesh-roo-detect-", {
      ".roomodes": "customModes: []\n",
      ".rooignore": "dist/\n",
      ".roo/mcp.json": "{}\n",
      ".roo/commands/release.md": "# release\n",
      ".roo/commands/nested/skip.md": "single-level only\n",
      "AGENTS.md": "wins\n",
      "AGENT.md": "read when AGENTS.md is absent\n",
      "packages/app/AGENTS.md": "nested - Roo documents root only\n",
    });
    expect(detect({ rootDir: root }).map((a) => [a.path, a.kind])).toEqual([
      [".roo/commands/release.md", "command"],
      [".roo/mcp.json", "mcp-config"],
      [".rooignore", "ignore"],
      [".roomodes", "modes"],
      ["AGENT.md", "instructions"],
      ["AGENTS.md", "instructions"],
    ]);
  });
});

describe("rooAdapter contract", () => {
  it("identifies itself and implements detect only", () => {
    expect(rooAdapter.name).toBe("roo");
    expect(() => rooAdapter.importArtifacts({ rootDir: "." })).toThrow(
      /not implemented/,
    );
    expect(() => rooAdapter.capabilities()).toThrow(/not implemented/);
    expect(() => rooAdapter.plan({})).toThrow(/not implemented/);
    expect(() => rooAdapter.emit({})).toThrow(/not implemented/);
  });
});
