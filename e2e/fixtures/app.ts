import {
  expect,
  test as base,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

interface SeedProject {
  id: string;
  issuePrefix: string;
  name: string;
}

interface AppFixtures {
  browserHealth: void;
  seedProject: SeedProject;
}

const PROJECT_NAME = "Playwright Smoke Project";

async function readSuccessfulJson<T>(response: APIResponse, action: string): Promise<T> {
  const body = await response.text();
  expect(
    response.ok(),
    `${action} failed with HTTP ${response.status()}: ${body}`,
  ).toBeTruthy();
  return JSON.parse(body) as T;
}

async function ensureSeedProject(request: APIRequestContext): Promise<SeedProject> {
  const health = await readSuccessfulJson<{ status: string }>(
    await request.get("/api/health"),
    "GitMesh health check",
  );
  expect(health.status).toBe("ok");

  const projects = await readSuccessfulJson<SeedProject[]>(
    await request.get("/api/projects"),
    "Project list",
  );
  const existing = projects.find((project) => project.name === PROJECT_NAME);
  if (existing) return existing;

  return readSuccessfulJson<SeedProject>(
    await request.post("/api/projects", {
      data: {
        name: PROJECT_NAME,
        description: "Disposable project for full-stack browser verification",
      },
    }),
    "Project seed",
  );
}

export const test = base.extend<AppFixtures>({
  seedProject: async ({ request }, use) => {
    await use(await ensureSeedProject(request));
  },

  browserHealth: [
    async ({ baseURL, page }, use, testInfo) => {
      if (!baseURL) throw new Error("Playwright baseURL is required");
      const expectedOrigin = new URL(baseURL).origin;
      const failures: string[] = [];

      page.on("pageerror", (error) => {
        failures.push(`page error: ${error.message}`);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          failures.push(`console error: ${message.text()}`);
        }
      });
      page.on("requestfailed", (request) => {
        if (new URL(request.url()).origin === expectedOrigin) {
          failures.push(
            `request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
          );
        }
      });
      page.on("response", (response) => {
        if (new URL(response.url()).origin === expectedOrigin && response.status() >= 400) {
          failures.push(
            `HTTP ${response.status()}: ${response.request().method()} ${response.url()}`,
          );
        }
      });

      await use(undefined);

      if (failures.length > 0) {
        await testInfo.attach("browser-health-failures", {
          body: Buffer.from(JSON.stringify(failures, null, 2)),
          contentType: "application/json",
        });
      }
      expect(failures, "The app emitted browser or same-origin network errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";