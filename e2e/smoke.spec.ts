import { expect, test } from "./fixtures/app.js";

test("boots the real app, redirects to the project dashboard, and survives a direct reload", async ({
  baseURL,
  page,
  seedProject,
}, testInfo) => {
  if (!baseURL) throw new Error("Playwright baseURL is required");

  const dashboardPath = `/${seedProject.issuePrefix}/dashboard`;
  const dashboardUrl = new URL(dashboardPath, baseURL).toString();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(dashboardUrl);

  const main = page.locator("#main-content");
  await expect(main).toBeVisible();
  await expect(
    main.getByRole("heading", { level: 1, name: seedProject.name, exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { level: 2, name: "live trace · 0", exact: true }),
  ).toBeVisible();
  await expect(main.getByText("No workers enabled. The forge is silent.", { exact: true })).toBeVisible();
  await expect(main.getByText("No GitHub repository connected.", { exact: true })).toBeVisible();

  if (testInfo.project.name === "desktop-chromium") {
    await expect(page.getByText("Mesh — live ledger", { exact: true })).toBeVisible();
    await expect(page.getByText("ctrl-plane: live", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
  } else {
    const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
    const newIssueButton = page.locator('button[aria-label="New Issue"]');
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("Mobile viewport is required");
    await expect(mobileNavigation).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(mobileNavigation.getByRole("link", { name: "Issues" })).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Agents" })).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Inbox" })).toBeVisible();
    await expect(newIssueButton).toBeVisible();

    const mobileLayout = await Promise.all([
      mobileNavigation.boundingBox(),
      newIssueButton.boundingBox(),
    ]).then(([navigation, newIssue]) => ({ navigation, newIssue }));
    expect(mobileLayout.navigation).not.toBeNull();
    expect(mobileLayout.newIssue).not.toBeNull();
    expect(mobileLayout.navigation!.x).toBeGreaterThanOrEqual(0);
    expect(mobileLayout.navigation!.x + mobileLayout.navigation!.width).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(mobileLayout.newIssue!.x).toBeGreaterThanOrEqual(0);
    expect(mobileLayout.newIssue!.x + mobileLayout.newIssue!.width).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(mobileLayout.newIssue!.y + mobileLayout.newIssue!.height).toBeLessThanOrEqual(
      mobileLayout.navigation!.y,
    );
  }

  const initialLayout = await page.evaluate(() => {
    const mainElement = document.querySelector<HTMLElement>("#main-content");
    const rect = mainElement?.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      mainHeight: rect?.height ?? 0,
      mainWidth: rect?.width ?? 0,
      viewportWidth: window.innerWidth,
    };
  });
  expect(initialLayout.documentWidth).toBeLessThanOrEqual(initialLayout.viewportWidth);
  expect(initialLayout.mainWidth).toBeGreaterThan(200);
  expect(initialLayout.mainHeight).toBeGreaterThan(200);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(dashboardUrl);
  await expect(
    page.locator("#main-content").getByRole("heading", {
      level: 1,
      name: seedProject.name,
      exact: true,
    }),
  ).toBeVisible();

  const screenshotPath = testInfo.outputPath(`${testInfo.project.name}-dashboard.png`);
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach(`${testInfo.project.name}-dashboard`, {
    path: screenshotPath,
    contentType: "image/png",
  });
});