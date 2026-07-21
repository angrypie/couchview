import { expect, test, type Page } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

async function openFixture(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle("Couch Review");
  const currentFile = page.getByRole("region", { name: "Current file" });
  await expect(currentFile).toContainText("src/review.ts");
  await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
  await expect(page.locator(".diff-row").first()).toBeVisible();
  return currentFile;
}

async function dismissPwaNotices(page: Page) {
  // The first production visit can announce offline readiness (and iOS can
  // simultaneously show its install hint). Clear those persistent notices so
  // they do not intentionally sit above the bottom sheets exercised below.
  await page.getByText("App shell is ready offline.").waitFor({ state: "visible", timeout: 2_500 }).catch(() => undefined);
  for (const name of ["Dismiss", "Not now", "Later"]) {
    const buttons = await page.getByRole("button", { name, exact: true }).all();
    for (const button of buttons) {
      if (await button.isVisible()) await button.click();
    }
  }
}

test.describe("mobile fixture review", () => {
  test.skip(!localFixture, "The deterministic workflow uses the bundled e2e repository fixture.");

  test.beforeEach(async ({ page, request }) => {
    await page.addInitScript(() => {
      localStorage.setItem("couch-review:install-hint-dismissed", "1");
    });
    const response = await request.post("/api/e2e/reset", {
      headers: { "x-couch-review-csrf": fixtureCsrf },
    });
    expect(response.ok()).toBe(true);
  });

  test("uses the full viewport while gutters stay fixed during horizontal code scroll", async ({
    page,
  }) => {
    const currentFile = await openFixture(page);
    await dismissPwaNotices(page);

    await expect
      .poll(() =>
        page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        })),
      )
      .toEqual(
        expect.objectContaining({
          documentWidth: await page.evaluate(() => window.innerWidth),
        }),
      );

    const fontValue = page.locator(".font-value");
    await expect(fontValue).toHaveText("11px");
    const increaseFont = page.getByRole("button", { name: "Increase diff font size" });
    for (let size = 12; size <= 16; size += 1) await increaseFont.click();
    await expect(fontValue).toHaveText("16px");
    await expect(increaseFont).toBeDisabled();
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--code-size").trim(),
        ),
      )
      .toBe("16px");

    const scroller = page.locator(".diff-scroller");
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeGreaterThan(20);

    const oldGutter = page.getByRole("button", { name: "Select old line 1", exact: true });
    const firstCode = page.locator(".code-line").first();
    const before = {
      gutterX: await oldGutter.evaluate((element) => element.getBoundingClientRect().x),
      codeX: await firstCode.evaluate((element) => element.getBoundingClientRect().x),
    };
    await scroller.evaluate((element) => {
      element.scrollLeft = Math.min(180, element.scrollWidth - element.clientWidth);
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(20);
    const after = {
      gutterX: await oldGutter.evaluate((element) => element.getBoundingClientRect().x),
      codeX: await firstCode.evaluate((element) => element.getBoundingClientRect().x),
    };
    expect(Math.abs(after.gutterX - before.gutterX)).toBeLessThanOrEqual(1.5);
    expect(after.codeX).toBeLessThan(before.codeX - 15);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);

    const actions = page.getByRole("navigation", { name: "Review actions" });
    const nextHunk = actions.getByRole("button", { name: "Next hunk" });
    const previousHunk = actions.getByRole("button", { name: "Previous hunk" });
    await expect(previousHunk).toBeDisabled();
    await nextHunk.click();
    await expect(nextHunk).toBeDisabled();
    await expect(previousHunk).toBeEnabled();
    await previousHunk.click();
    await expect(previousHunk).toBeDisabled();

    await actions.getByRole("button", { name: "Next file" }).click();
    await expect(currentFile).toContainText("src/format.ts");
    // The compact bottom bar intentionally hides its duplicate previous-file
    // icon below 420px; the sticky file header always keeps this action.
    await currentFile.getByRole("button", { name: "Previous file" }).click();
    await expect(currentFile).toContainText("src/review.ts");
  });

  test("searches, comments on a replacement, stages, and reviews with one-tap advance", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "clipboard", {
        configurable: true,
        get: () => ({
          writeText: () => Promise.reject(new DOMException("Blocked for e2e", "NotAllowedError")),
        }),
      });
      Object.defineProperty(Document.prototype, "execCommand", {
        configurable: true,
        value: () => false,
      });
    });
    const currentFile = await openFixture(page);
    await dismissPwaNotices(page);

    await page.locator(".word-button", { hasText: /^load$/ }).first().click();
    const search = page.getByRole("dialog", { name: "Project search" });
    await expect(search).toBeVisible();
    const currentHit = search.getByRole("button", { name: /src\/review\.ts:2:16/ });
    await expect(currentHit).toBeVisible();
    await currentHit.click();
    await expect(search.locator(".source-preview")).toContainText("src/review.ts");
    await search.getByRole("button", { name: "Back to results" }).click();
    await search.getByRole("button", { name: /Other files \(1\)/ }).click();
    await expect(search.getByRole("button", { name: /src\/format\.ts:2:10/ })).toBeVisible();
    await search.getByRole("button", { name: "Close search" }).click();

    await page.getByRole("button", { name: "Select old line 2" }).click();
    await page.getByRole("button", { name: "Select new line 2" }).click();
    const selection = page.getByRole("status").filter({
      hasText: "Old lines 2 / new lines 2",
    });
    await expect(selection).toBeVisible();
    await selection.getByRole("button", { name: "Comment" }).click();

    const editor = page.getByRole("dialog", { name: "Add review comment" });
    await expect(editor).toContainText("src/review.ts:old L2 / new L2");
    await editor
      .getByPlaceholder("Describe the issue and the expected correction…")
      .fill("Keep the loaded result intact before returning its files.");
    await editor.getByRole("button", { name: "Add comment" }).click();
    await expect(page.getByText("Comment added", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Open comments (1)" }).click();
    const tray = page.getByRole("dialog", { name: "Review comments" });
    await expect(tray).toContainText("src/review.ts:old L2 / new L2");
    await expect(tray).toContainText("Keep the loaded result intact");
    await tray.getByRole("button", { name: "Copy 1 for Codex" }).click();

    const manualCopy = page.getByRole("dialog", { name: "Copy comments manually" });
    await expect(manualCopy).toBeVisible();
    const correctionPrompt = await manualCopy.getByRole("textbox").inputValue();
    expect(correctionPrompt).toContain("Please address each review comment below");
    expect(correctionPrompt).toContain("src/review.ts:old L2 / new L2");
    expect(correctionPrompt).toContain("Keep the loaded result intact before returning its files.");
    await manualCopy.getByRole("button", { name: "Close manual copy dialog" }).click();

    const actions = page.getByRole("navigation", { name: "Review actions" });
    const stage = actions.getByRole("button", { name: "Stage current file" });
    await stage.click();
    await expect(page.getByText("File staged", { exact: true })).toBeVisible();
    await expect(stage).toBeDisabled();
    await expect(currentFile.locator(".status-pill.staged")).toHaveText("staged");

    await actions.getByRole("button", { name: "Review + next" }).click();
    await expect(currentFile).toContainText("src/format.ts");
    await expect(page.getByText("Marked reviewed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  });
});

test.describe("production PWA", () => {
  test("has a valid manifest, an uncached live API, a disconnected shell, and update/install affordances", async ({
    browserName,
    context,
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Couch Review");

    const manifest = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) throw new Error("Missing web app manifest link");
      const response = await fetch(link.href);
      return response.json() as Promise<{
        display: string;
        start_url: string;
        scope: string;
        icons: Array<{ src: string; sizes: string; purpose?: string }>;
      }>;
    });
    expect(manifest).toEqual(
      expect.objectContaining({ display: "standalone", start_url: "/", scope: "/" }),
    );
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
    expect(manifest.icons.every((icon) => icon.src.startsWith("/"))).toBe(true);

    const registration = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) throw new Error("Service workers are unavailable");
      const ready = await navigator.serviceWorker.ready;
      return { active: Boolean(ready.active), scope: ready.scope };
    });
    expect(registration.active).toBe(true);
    expect(registration.scope).toBe(new URL("/", page.url()).href);
    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
      await page.reload();
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    }

    const apiResponse = await page.evaluate(async () => {
      const response = await fetch("/api/files", { cache: "no-store" });
      return { ok: response.ok, cacheControl: response.headers.get("cache-control") };
    });
    expect(apiResponse.ok).toBe(true);
    expect(apiResponse.cacheControl).toContain("no-store");
    const cacheUrls = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => request.url));
      }
      return urls;
    });
    expect(cacheUrls.some((url) => new URL(url).pathname.startsWith("/api/"))).toBe(false);
    expect(cacheUrls.some((url) => new URL(url).pathname === "/index.html")).toBe(true);
    expect(cacheUrls.some((url) => /\/assets\/[^/]+-[^/]+\.(?:js|css)$/.test(new URL(url).pathname))).toBe(
      true,
    );

    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.defineProperties(event, {
        prompt: { value: async () => undefined },
        userChoice: { value: Promise.resolve({ outcome: "dismissed" }) },
      });
      window.dispatchEvent(event);
    });
    await expect(page.getByText("Install Couch Review for full-screen access.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Install", exact: true })).toBeVisible();

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register(
        `/sw.js?e2e-update=${Date.now()}`,
        { scope: "/" },
      );
      if (registration.waiting) return;
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 10_000);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed") {
              window.clearTimeout(timeout);
              resolve();
            }
          });
        });
      });
    });
    await expect(page.getByText("An app update is ready.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();

    await context.setOffline(true);
    try {
      const apiOffline = await page.evaluate(async () => {
        try {
          await fetch("/api/files", { cache: "no-store" });
          return false;
        } catch {
          return true;
        }
      });
      expect(apiOffline).toBe(true);
      if (browserName === "webkit") {
        // WebKit's Playwright transport currently reports an internal error
        // for an offline service-worker navigation. The already-loaded shell
        // must still remain rendered while an API request fails offline.
        await expect(page.getByRole("region", { name: "Current file" })).toBeVisible();
      } else {
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page).toHaveTitle("Couch Review");
        await expect(page.getByRole("heading", { name: "Couldn’t open Couch Review" })).toBeVisible();
      }
    } finally {
      await context.setOffline(false);
    }
  });
});
