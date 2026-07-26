import { expect, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

interface TerminalFixtureState {
  running: boolean;
  attachmentCount: number;
  socketConnections: number;
  inputs: string[];
  resizes: Array<{ cols: number; rows: number }>;
}

test.describe("desktop tmux terminal", () => {
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

    await page.getByRole("button", { name: "Open tmux terminal" }).click();

    const workspace = page.getByRole("region", { name: "tmux terminal" });
    await expect(workspace).toBeVisible();
    await expect(workspace.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".terminal-surface")).toHaveCSS(
      "caret-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect.poll(() => loadedAssets.some(
      (pathname) => /\/assets\/ghostty-web-[^/]+\.js$/.test(pathname),
    )).toBe(true);
    await expect.poll(() => loadedAssets.some(
      (pathname) => /\/assets\/ghostty-vt-[^/]+\.wasm$/.test(pathname),
    )).toBe(true);
    await expect.poll(() => loadedAssets.some(
      (pathname) => /\/assets\/Hack-Regular-[^/]+\.ttf$/.test(pathname),
    )).toBe(true);
    await expect.poll(() => loadedAssets.some(
      (pathname) => /\/assets\/Hack-Bold-[^/]+\.ttf$/.test(pathname),
    )).toBe(true);
    const state = async () => (await (
      await request.get("/api/e2e/terminal")
    ).json()) as TerminalFixtureState;
    await expect.poll(async () => (await state()).socketConnections).toBe(1);

    const initialDimensions = (await state()).resizes.at(-1);
    expect(initialDimensions).toBeDefined();
    const previousRowContamination = await page.locator(".terminal-surface canvas").evaluate(
      (canvas, rows) => {
        const context = (canvas as HTMLCanvasElement).getContext("2d");
        if (!context) return -1;
        const rowHeight = (canvas as HTMLCanvasElement).height / rows;
        const pixels = context.getImageData(
          0,
          0,
          Math.min(240, (canvas as HTMLCanvasElement).width),
          Math.floor(rowHeight),
        ).data;
        let contaminated = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            pixels[index] !== 30 ||
            pixels[index + 1] !== 30 ||
            pixels[index + 2] !== 46
          ) {
            contaminated += 1;
          }
        }
        return contaminated;
      },
      initialDimensions!.rows,
    );
    expect(previousRowContamination).toBe(0);

    const bounds = await workspace.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(1270);
    expect(bounds!.height).toBeGreaterThanOrEqual(790);

    const terminalSurface = page.locator(".terminal-surface");
    await terminalSurface.click();
    await page.keyboard.down("u");
    await expect(terminalSurface).toHaveAttribute("contenteditable", "false");
    await page.keyboard.down("u");
    await page.keyboard.down("u");
    await page.keyboard.up("u");
    await expect(terminalSurface).toHaveAttribute("contenteditable", "true");
    await expect.poll(async () => (await state()).inputs.join("")).toContain("uuu");

    await page.keyboard.type("hello-from-browser");
    await expect.poll(async () => (await state()).inputs.join("")).toContain(
      "hello-from-browser",
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
    await page.getByRole("button", { name: "Open tmux terminal" }).click();
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
