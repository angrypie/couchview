import { expect, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

interface TerminalFixtureState {
  running: boolean;
  attachmentCount: number;
  socketConnections: number;
  target: {
    fileId: string;
    contentRevision: string;
    line: number;
  } | null;
  inputs: string[];
  resizes: Array<{ cols: number; rows: number }>;
}

test.describe("desktop Neovim workspace", () => {
  test.skip(!localFixture, "The deterministic terminal uses the bundled e2e fixture.");

  test.beforeEach(async ({ request }) => {
    const response = await request.post("/api/e2e/reset", {
      headers: { "x-couchview-csrf": fixtureCsrf },
    });
    expect(response.ok()).toBe(true);
  });

  test("loads Ghostty on demand and preserves one live terminal across Review handoffs", async ({
    page,
    request,
  }) => {
    const loadedAssets: string[] = [];
    page.on("requestfinished", (networkRequest) => {
      loadedAssets.push(new URL(networkRequest.url()).pathname);
    });

    await page.goto("/");
    await expect(page).toHaveTitle("Couchview");
    await expect(page.getByRole("region", { name: "Current file" })).toContainText(
      "src/review.ts",
    );
    expect(
      loadedAssets.some((pathname) =>
        pathname.includes("ghostty-web") || pathname.endsWith(".wasm")
      ),
    ).toBe(false);

    await page.getByRole("button", { name: "Show line numbers" }).click();
    await page.getByRole("button", { name: "Select new line 14" }).click();
    await page.getByRole("button", { name: "Edit current file in Neovim" }).click();

    const workspace = page.getByRole("region", { name: "Neovim workspace" });
    await expect(workspace).toBeVisible();
    await expect(workspace.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(() => loadedAssets.some(
      (pathname) => /\/assets\/ghostty-web-[^/]+\.js$/.test(pathname),
    )).toBe(true);
    await expect.poll(() => loadedAssets.some(
      (pathname) => /\/assets\/ghostty-vt-[^/]+\.wasm$/.test(pathname),
    )).toBe(true);

    const state = async () => (await (
      await request.get("/api/e2e/terminal")
    ).json()) as TerminalFixtureState;
    await expect.poll(async () => (await state()).target).toEqual({
      fileId: "fixture-review-ts",
      contentRevision: "fixture-review-v1",
      line: 14,
    });
    await expect.poll(async () => (await state()).socketConnections).toBe(1);

    const bounds = await workspace.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(1270);
    expect(bounds!.height).toBeGreaterThanOrEqual(790);

    await page.locator(".terminal-surface").click();
    await page.keyboard.type("ihello-from-browser");
    await expect.poll(async () => (await state()).inputs.join("")).toContain(
      "ihello-from-browser",
    );

    const resizeCount = (await state()).resizes.length;
    await page.setViewportSize({ width: 1080, height: 700 });
    await expect.poll(async () => (await state()).resizes.length).toBeGreaterThan(
      resizeCount,
    );

    const connectedState = await state();
    await workspace.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
    await expect(workspace).toBeHidden();
    await page.getByRole("button", { name: "Open Neovim workspace" }).click();
    await expect(workspace).toBeVisible();
    await expect(workspace.getByText("Connected", { exact: true })).toBeVisible();
    expect((await state()).attachmentCount).toBe(connectedState.attachmentCount);
    expect((await state()).socketConnections).toBe(connectedState.socketConnections);

    page.once("dialog", (dialog) => void dialog.accept());
    await workspace.getByRole("button", { name: "End session" }).click();
    await expect.poll(async () => (await state()).running).toBe(false);
    await expect(workspace.getByText("Session ended", { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(750);
    expect((await state()).attachmentCount).toBe(connectedState.attachmentCount);
    expect((await state()).socketConnections).toBe(connectedState.socketConnections);
    expect((await state()).running).toBe(false);
  });
});
