import { afterEach, describe, expect, it } from "vitest";
import type { Command } from "commander";
import { createProgram, type CliMode } from "../program.js";
import { registerLegacyCommands } from "../legacy.js";

const STUB_NAMES = ["apply", "check", "init", "migrate", "policy"];

function makeHarness(mode: CliMode, { legacy = true }: { legacy?: boolean } = {}) {
  let out = "";
  let err = "";
  const program = createProgram(
    mode,
    (p) => {
      p.exitOverride();
      p.configureOutput({
        writeOut: (s) => {
          out += s;
        },
        writeErr: (s) => {
          err += s;
        },
      });
    },
    legacy ? registerLegacyCommands : undefined,
  );
  return { program, out: () => out, err: () => err };
}

function commandNames(command: Command): string[] {
  return command.commands.map((c) => c.name()).sort();
}

function legacyGroup(program: Command): Command {
  const legacy = program.commands.find((c) => c.name() === "legacy");
  if (!legacy) {
    throw new Error("legacy group not found");
  }
  return legacy;
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("createProgram (gitmesh mode)", () => {
  it("exposes exactly the new command tree at top level", () => {
    const { program } = makeHarness("gitmesh");
    expect(commandNames(program)).toEqual([...STUB_NAMES, "doctor", "legacy"].sort());
  });

  it("moves every gitmesh-agents command under the legacy group", () => {
    const { program } = makeHarness("gitmesh");
    const agents = makeHarness("gitmesh-agents").program;
    expect(commandNames(legacyGroup(program))).toEqual(commandNames(agents));
  });

  it("keeps key legacy commands reachable, including project connect", () => {
    const { program } = makeHarness("gitmesh");
    const legacy = legacyGroup(program);
    const names = commandNames(legacy);
    for (const expected of ["setup", "run", "db:backup", "heartbeat", "auth", "project"]) {
      expect(names).toContain(expected);
    }
    const project = legacy.commands.find((c) => c.name() === "project");
    expect(project?.commands.map((c) => c.name())).toContain("connect");
  });

  it.each(STUB_NAMES)("stub %s prints not-implemented and exits 1", async (name) => {
    const { program, err } = makeHarness("gitmesh");
    await expect(program.parseAsync([name], { from: "user" })).rejects.toMatchObject({
      exitCode: 1,
    });
    expect(err()).toContain(`gitmesh ${name}: not implemented yet`);
  });

  it("renders help with the new tree", () => {
    const { program } = makeHarness("gitmesh");
    const help = program.helpInformation();
    expect(help).toContain("Usage: gitmesh");
    for (const name of [...STUB_NAMES, "doctor", "legacy"]) {
      expect(help).toContain(name);
    }
  });

  it("renders legacy group help with legacy commands", () => {
    const { program } = makeHarness("gitmesh");
    expect(legacyGroup(program).helpInformation()).toContain("setup");
  });

  it("--help exits via helpDisplayed with usage on stdout", async () => {
    const { program, out } = makeHarness("gitmesh");
    await expect(program.parseAsync(["--help"], { from: "user" })).rejects.toMatchObject({
      code: "commander.helpDisplayed",
    });
    expect(out()).toContain("Usage: gitmesh");
  });
});

describe("createProgram (gitmesh mode, published package: no legacy registrar)", () => {
  it("still lists legacy in help", () => {
    const { program } = makeHarness("gitmesh", { legacy: false });
    expect(commandNames(program)).toEqual([...STUB_NAMES, "doctor", "legacy"].sort());
  });

  it("legacy invocations exit 1 with install guidance instead of running", async () => {
    const { program, err } = makeHarness("gitmesh", { legacy: false });
    await expect(
      program.parseAsync(["legacy", "setup"], { from: "user" }),
    ).rejects.toMatchObject({ exitCode: 1 });
    expect(err()).toContain("not included in the gitmesh-cli package");
  });
});

describe("createProgram (gitmesh-agents mode)", () => {
  it("preserves the old root surface", () => {
    const { program } = makeHarness("gitmesh-agents");
    const help = program.helpInformation();
    expect(help).toContain("Usage: gitmesh-agents");
    expect(help).toContain("setup");
    expect(commandNames(program)).not.toContain("legacy");
    expect(commandNames(program)).not.toContain("apply");
  });
});
