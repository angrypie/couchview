import { expect, test } from "@playwright/test";

import type { ChangesResponse } from "../../src/shared/contracts.ts";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

test.describe("desktop review layout", () => {
  test.skip(!localFixture, "The long file list uses the bundled e2e fixture.");

  test.beforeEach(async ({ request }) => {
    const response = await request.post("/api/e2e/reset", {
      headers: { "x-couchview-csrf": fixtureCsrf },
    });
    expect(response.ok()).toBe(true);
  });

  test("keeps file controls visible while the changed-files list scrolls", async ({
    page,
  }) => {
    await page.route("**/api/repositories/*/files", async (route) => {
      const response = await route.fetch();
      const body = await response.json() as ChangesResponse;
      const template = body.files.at(-1)!;
      const extraFiles = Array.from({ length: 28 }, (_, index) => ({
        ...template,
        id: `fixture-extra-${index + 1}`,
        path: `src/generated/file-${String(index + 1).padStart(2, "0")}.ts`,
        contentRevision: `fixture-extra-v${index + 1}`,
      }));
      await route.fulfill({
        response,
        json: { ...body, files: [...body.files, ...extraFiles] },
      });
    });

    await page.goto("/");

    const drawer = page.getByRole("complementary", { name: "Changed files" });
    const fileList = drawer.locator(".file-list");
    const footer = drawer.locator(".drawer-footer");

    await expect(drawer.getByRole("button", { name: "Stage all files (30)" })).toBeVisible();
    await expect(footer).toBeVisible();
    await expect.poll(() => fileList.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }))).toMatchObject({ overflowY: "auto" });

    const listMetrics = await fileList.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight);

    const footerBottom = await footer.evaluate(
      (element) => element.getBoundingClientRect().bottom,
    );
    expect(footerBottom).toBeLessThanOrEqual(800);

    await fileList.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => fileList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(
      drawer.getByRole("button", {
        name: "src/generated/file-28.ts added unstaged +4 −0",
      }),
    ).toBeVisible();
  });
});
