import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCursorPlaybooksInjected } from "@gitmesh/adapter-cursor-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createPlaybookDir(root: string, name: string) {
  await fs.mkdir(path.join(root, name), { recursive: true });
}

describe("cursor local adapter playbook injection", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("links missing GitMesh Agents playbooks into Cursor skills home", async () => {
    const skillsDir = await makeTempDir("gitmesh-agents-cursor-playbooks-src-");
    const skillsHome = await makeTempDir("gitmesh-agents-cursor-playbooks-home-");
    cleanupDirs.add(skillsDir);
    cleanupDirs.add(skillsHome);

    await createPlaybookDir(skillsDir, "core");
    await createPlaybookDir(skillsDir, "adapter-dev");
    await fs.writeFile(path.join(skillsDir, "README.txt"), "ignore", "utf8");

    const logs: string[] = [];
    await ensureCursorPlaybooksInjected(
      async (_stream, chunk) => {
        logs.push(chunk);
      },
      { playbooksDir: skillsDir, playbooksHome: skillsHome },
    );

    const injectedA = path.join(skillsHome, "core");
    const injectedB = path.join(skillsHome, "adapter-dev");
    expect((await fs.lstat(injectedA)).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(injectedB)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(injectedA)).toBe(await fs.realpath(path.join(skillsDir, "core")));
    expect(await fs.realpath(injectedB)).toBe(
      await fs.realpath(path.join(skillsDir, "adapter-dev")),
    );
    expect(logs.some((line) => line.includes('Injected Cursor skill "core"'))).toBe(true);
    expect(logs.some((line) => line.includes('Injected Cursor skill "adapter-dev"'))).toBe(true);
  });

  it("preserves existing targets and only links missing playbooks", async () => {
    const skillsDir = await makeTempDir("gitmesh-agents-cursor-preserve-src-");
    const skillsHome = await makeTempDir("gitmesh-agents-cursor-preserve-home-");
    cleanupDirs.add(skillsDir);
    cleanupDirs.add(skillsHome);

    await createPlaybookDir(skillsDir, "core");
    await createPlaybookDir(skillsDir, "adapter-dev");

    const existingTarget = path.join(skillsHome, "core");
    await fs.mkdir(existingTarget, { recursive: true });
    await fs.writeFile(path.join(existingTarget, "keep.txt"), "keep", "utf8");

    await ensureCursorPlaybooksInjected(async () => {}, { playbooksDir: skillsDir, playbooksHome: skillsHome });

    expect((await fs.lstat(existingTarget)).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(existingTarget, "keep.txt"), "utf8")).toBe("keep");
    expect((await fs.lstat(path.join(skillsHome, "adapter-dev"))).isSymbolicLink()).toBe(true);
  });

  it("logs per-skill link failures and continues without throwing", async () => {
    const skillsDir = await makeTempDir("gitmesh-agents-cursor-fail-src-");
    const skillsHome = await makeTempDir("gitmesh-agents-cursor-fail-home-");
    cleanupDirs.add(skillsDir);
    cleanupDirs.add(skillsHome);

    await createPlaybookDir(skillsDir, "ok-playbook");
    await createPlaybookDir(skillsDir, "fail-playbook");

    const logs: string[] = [];
    await ensureCursorPlaybooksInjected(
      async (_stream, chunk) => {
        logs.push(chunk);
      },
      {
        playbooksDir: skillsDir,
        playbooksHome: skillsHome,
        linkSkill: async (source, target) => {
          if (target.endsWith(`${path.sep}fail-playbook`)) {
            throw new Error("simulated link failure");
          }
          await fs.symlink(
            source,
            target,
            process.platform === "win32" ? "junction" : undefined,
          );
        },
      },
    );

    expect((await fs.lstat(path.join(skillsHome, "ok-playbook"))).isSymbolicLink()).toBe(true);
    await expect(fs.lstat(path.join(skillsHome, "fail-playbook"))).rejects.toThrow();
    expect(logs.some((line) => line.includes('Failed to inject Cursor skill "fail-playbook"'))).toBe(true);
  });
});
