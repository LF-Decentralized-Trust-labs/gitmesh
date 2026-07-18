import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveE2EEnvironment } from "./environment.js";

describe("resolveE2EEnvironment", () => {
  it("uses an isolated temp home and port 3210 by default", () => {
    const resolved = resolveE2EEnvironment({});

    expect(resolved.port).toBe(3210);
    expect(resolved.baseURL).toBe("http://127.0.0.1:3210");
    expect(resolved.home).toBe(path.join(os.tmpdir(), "gitmesh-agents-playwright-3210"));
    expect(resolved.instanceRoot).toBe(
      path.join(resolved.home, "instances", "playwright"),
    );
  });

  it("accepts a custom safe temp home and valid port", () => {
    const customHome = path.join(os.tmpdir(), "gitmesh-agents-playwright-custom");
    const resolved = resolveE2EEnvironment({
      GITMESH_E2E_HOME: customHome,
      GITMESH_E2E_PORT: "4321",
    });

    expect(resolved.home).toBe(customHome);
    expect(resolved.port).toBe(4321);
    expect(resolved.baseURL).toBe("http://127.0.0.1:4321");
  });

  it.each(["1023", "65536", "not-a-port", "3210.5"])(
    "rejects invalid port %s",
    (port) => {
      expect(() => resolveE2EEnvironment({ GITMESH_E2E_PORT: port })).toThrow(
        "GITMESH_E2E_PORT must be an integer between 1024 and 65535",
      );
    },
  );

  it("refuses to manage a home outside the OS temp directory", () => {
    expect(() =>
      resolveE2EEnvironment({
        GITMESH_E2E_HOME: path.resolve(os.tmpdir(), "..", "gitmesh-agents-playwright-unsafe"),
      }),
    ).toThrow("Refusing to manage unsafe E2E home");
  });

  it("refuses a temp home without the Playwright safety prefix", () => {
    expect(() =>
      resolveE2EEnvironment({
        GITMESH_E2E_HOME: path.join(os.tmpdir(), "unrelated-directory"),
      }),
    ).toThrow("Refusing to manage unsafe E2E home");
  });
});