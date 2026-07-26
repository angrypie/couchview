import { expect, test, type Page } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

async function openFixture(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle("Couchview");
  const currentFile = page.getByRole("region", { name: "Current file" });
  await expect(currentFile).toContainText("src/review.ts");
  await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
  await expect(page.locator(".pierre-code-view diffs-container")).toBeVisible();
  await expect(page.locator("diffs-container [data-line]").first()).toBeVisible();
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
      localStorage.setItem("couchview:install-hint-dismissed", "1");
    });
    const response = await request.post("/api/e2e/reset", {
      headers: { "x-couchview-csrf": fixtureCsrf },
    });
    expect(response.ok()).toBe(true);
  });

  test("keeps focused form controls from triggering mobile page zoom", async ({
    page,
  }) => {
    await openFixture(page);
    await dismissPwaNotices(page);

    await page.getByRole("button", { name: "Open changed files" }).click();
    const filter = page.getByRole("searchbox", { name: "Filter changed files" });
    await expect(filter).toHaveCSS("font-size", "16px");
    await expect(filter).toHaveCSS("touch-action", "manipulation");
    await filter.focus();
    await expect
      .poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1))
      .toBe(1);
    await page
      .getByRole("complementary", { name: "Changed files" })
      .getByRole("button", { name: "Close changed files" })
      .click();

    await page.getByRole("button", { name: "Show line numbers" }).click();
    await page.getByRole("button", { name: "Select old line 2" }).click();
    await page.getByRole("button", { name: "Select new line 2" }).click();
    const selection = page.getByRole("status").filter({
      hasText: "Old lines 2 / new lines 2",
    });
    await selection.getByRole("button", { name: "Comment" }).click();

    const comment = page.getByPlaceholder(
      "Describe the issue and the expected correction…",
    );
    await expect(comment).toHaveCSS("font-size", "16px");
    await expect(comment).toHaveCSS("touch-action", "manipulation");
    await expect
      .poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1))
      .toBe(1);
  });

  test("uses the full viewport while gutters stay fixed during horizontal code scroll", async ({
    page,
  }, testInfo) => {
    const currentFile = await openFixture(page);
    await dismissPwaNotices(page);
    await expect(
      page.locator("diffs-container [data-line]").filter({
        hasText: "visible between hunks",
      }),
    ).toBeVisible();

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
    const codeHost = page.locator("diffs-container").first();
    const renderedFont = () =>
      codeHost.evaluate((host) => {
        const line = host.shadowRoot?.querySelector<HTMLElement>("[data-line]");
        const hostStyle = getComputedStyle(host);
        return {
          fontSize: line ? getComputedStyle(line).fontSize : "",
          hostFontSize: hostStyle.fontSize,
          lineHeight: line
            ? Math.round(Number.parseFloat(getComputedStyle(line).lineHeight) * 100) / 100
            : 0,
          textInflationDisabled: Array.from(
            host.shadowRoot?.querySelectorAll("style") ?? [],
          ).some((style) =>
            style.textContent?.includes("-webkit-text-size-adjust: 100%"),
          ),
        };
      });
    await expect.poll(renderedFont).toEqual({
      fontSize: "11px",
      hostFontSize: "11px",
      lineHeight: 17.05,
      textInflationDisabled: true,
    });

    const fileSwitchControls = testInfo.project.name.includes("landscape")
      ? page.getByRole("navigation", { name: "Review actions" })
      : currentFile;
    await fileSwitchControls.getByRole("button", { name: "Next file" }).click();
    await expect(currentFile).toContainText("src/format.ts");
    await expect.poll(renderedFont).toEqual({
      fontSize: "11px",
      hostFontSize: "11px",
      lineHeight: 17.05,
      textInflationDisabled: true,
    });
    await fileSwitchControls.getByRole("button", { name: "Previous file" }).click();
    await expect(currentFile).toContainText("src/review.ts");

    await expect
      .poll(() =>
        codeHost.evaluate((host) =>
          Boolean(host.shadowRoot?.querySelector("[data-disable-line-numbers]")),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        codeHost.evaluate((host) => {
          const number = host.shadowRoot?.querySelector<HTMLElement>("[data-column-number]");
          return number?.getBoundingClientRect().width ?? 100;
        }),
      )
      .toBeLessThanOrEqual(6);
    await page.getByRole("button", { name: "Show line numbers" }).click();
    await expect(page.getByRole("button", { name: "Hide line numbers" })).toBeVisible();

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

    const scroller = page.locator("diffs-container [data-code]").first();
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeGreaterThan(20);

    const oldGutter = page.getByRole("button", { name: "Select new line 1", exact: true });
    const firstCode = page.locator("diffs-container [data-line]").first();
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
    await page.getByRole("button", { name: "Wrap long lines" }).click();
    await expect(page.getByRole("button", { name: "Keep long lines on one line" })).toBeVisible();
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() => localStorage.getItem("couchview:line-wrap")),
    ).toBe("true");
    await expect(page.getByRole("button", { name: "Find “load” in project" }).first()).toBeVisible();
    expect(
      await codeHost.evaluate((host) =>
        host.shadowRoot?.querySelectorAll("[data-char]").length ?? 0,
      ),
    ).toBeGreaterThan(0);

    const actions = page.getByRole("navigation", { name: "Review actions" });
    const hunkActions = testInfo.project.name.includes("landscape")
      ? page.locator(".compact-hunk-nav")
      : actions.locator(".hunk-nav");
    const nextHunk = hunkActions.getByRole("button", { name: "Next hunk" });
    const previousHunk = hunkActions.getByRole("button", { name: "Previous hunk" });
    await expect(previousHunk).toBeDisabled();
    await nextHunk.click();
    await expect(nextHunk).toBeEnabled();
    await expect(previousHunk).toBeDisabled();
    await nextHunk.click();
    await expect(nextHunk).toBeDisabled();
    await expect(previousHunk).toBeEnabled();
    await previousHunk.click();
    await expect(previousHunk).toBeDisabled();

    await actions.getByRole("button", { name: "Next file" }).click();
    await expect(currentFile).toContainText("src/format.ts");
    const previousFile = testInfo.project.name.includes("landscape")
      ? actions.getByRole("button", { name: "Previous file" })
      : currentFile.getByRole("button", { name: "Previous file" });
    await previousFile.click();
    await expect(currentFile).toContainText("src/review.ts");
  });

  test("preloads adjacent diffs for flash-free back-and-forth navigation", async ({
    page,
  }, testInfo) => {
    const diffRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/files/") && request.url().endsWith("/diff")) {
        diffRequests.push(request.url());
      }
    });
    const prefetched = page.waitForResponse((response) =>
      response.url().endsWith("/files/fixture-format-ts/diff"),
    );
    const currentFile = await openFixture(page);
    await prefetched;
    await page.evaluate(() => {
      const state = window as typeof window & {
        __loadingDiffObserved?: boolean;
        __loadingDiffObserver?: MutationObserver;
      };
      state.__loadingDiffObserved = false;
      state.__loadingDiffObserver = new MutationObserver(() => {
        if (document.body.textContent?.includes("Loading diff…")) {
          state.__loadingDiffObserved = true;
        }
      });
      state.__loadingDiffObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });

    const actions = page.getByRole("navigation", { name: "Review actions" });
    await actions.getByRole("button", { name: "Next file" }).click();
    await expect(currentFile).toContainText("src/format.ts");
    await expect(page.getByText("Loading diff…")).toHaveCount(0);
    const previousFile = testInfo.project.name.includes("landscape")
      ? actions.getByRole("button", { name: "Previous file" })
      : currentFile.getByRole("button", { name: "Previous file" });
    await previousFile.click();
    await expect(currentFile).toContainText("src/review.ts");

    const loadingObserved = await page.evaluate(() => {
      const state = window as typeof window & {
        __loadingDiffObserved?: boolean;
        __loadingDiffObserver?: MutationObserver;
      };
      state.__loadingDiffObserver?.disconnect();
      return state.__loadingDiffObserved;
    });
    expect(loadingObserved).toBe(false);
    expect(
      diffRequests.filter((url) =>
        url.endsWith("/files/fixture-review-ts/diff"),
      ),
    ).toHaveLength(1);
    expect(
      diffRequests.filter((url) =>
        url.endsWith("/files/fixture-format-ts/diff"),
      ),
    ).toHaveLength(1);
  });

  test("searches, comments on a replacement, stages, and reviews with one-tap advance", async ({
    page,
  }, testInfo) => {
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

    const loadToken = page.getByRole("button", { name: "Find “load” in project" }).first();
    await loadToken.focus();
    await page.keyboard.press("Enter");
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

    await page.getByRole("button", { name: "Show line numbers" }).click();
    await page.getByRole("button", { name: "Select old line 2" }).focus();
    await page.keyboard.press("Space");
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

    const inlineChip = page.getByRole("button", { name: /Open comment at src\/review\.ts/ });
    await expect(inlineChip).toContainText("Keep the loaded result intact");
    await inlineChip.click();
    const tray = page.getByRole("dialog", { name: "Review comments" });
    await expect(tray).toContainText("src/review.ts:old L2 / new L2");
    await expect(tray).toContainText("Keep the loaded result intact");
    await expect(tray.locator('[data-comment-id="fixture-comment-1"]')).toBeFocused();
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
    await expect(actions.getByRole("button", { name: "Unstage current file" })).toBeVisible();
    await expect(currentFile.locator(".status-pill.staged")).toHaveText("staged");

    const landscape = testInfo.project.name.includes("landscape");
    await actions
      .getByRole("button", { name: landscape ? "Review current file" : "Review + next" })
      .click();
    if (landscape) {
      await expect(currentFile).toContainText("src/review.ts");
      await actions.getByRole("button", { name: "Next file" }).click();
    }
    await expect(currentFile).toContainText("src/format.ts");
    await expect(page.getByText("Marked reviewed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  });

  test("commits staged changes from the phone drawer", async ({ page }) => {
    const currentFile = await openFixture(page);
    await dismissPwaNotices(page);

    const actions = page.getByRole("navigation", { name: "Review actions" });
    await actions.getByRole("button", { name: "Stage current file" }).click();
    await expect(page.getByText("File staged", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Open changed files" }).click();
    const drawer = page.getByRole("complementary", { name: "Changed files" });
    await drawer.getByRole("button", { name: "Commit 1 staged file" }).click();

    const composer = page.getByRole("dialog", { name: "Commit staged changes" });
    await expect(composer).toContainText("unstaged edits stay local");
    await expect(composer).toContainText("Only staged changes are sent to Codex");
    await composer.getByRole("button", { name: "Generate with Codex" }).click();
    const message = composer.getByPlaceholder("Commit message…");
    await expect(message).toHaveValue(
      "feat(review): generate commit messages with Codex",
    );
    await message.fill("fix(review): edit generated message on phone");
    await composer.getByRole("button", { name: "Commit staged changes" }).click();

    await expect(page.getByText("Committed abc1234", { exact: true })).toBeVisible();
    await expect(currentFile).toContainText("src/format.ts");
  });

  test("bulk stages reviewed files or the entire change set", async ({
    page,
  }, testInfo) => {
    const currentFile = await openFixture(page);
    await dismissPwaNotices(page);
    const actions = page.getByRole("navigation", { name: "Review actions" });
    const landscape = testInfo.project.name.includes("landscape");

    await actions
      .getByRole("button", {
        name: landscape ? "Review current file" : "Review + next",
      })
      .click();
    if (!landscape) {
      await expect(currentFile).toContainText("src/format.ts");
      await currentFile.getByRole("button", { name: "Previous file" }).click();
    }
    await expect(currentFile).toContainText("src/review.ts");

    await page.getByRole("button", { name: "Open changed files" }).click();
    const drawer = page.getByRole("complementary", { name: "Changed files" });
    await expect(
      drawer.getByRole("button", { name: "Stage reviewed files (1)" }),
    ).toBeVisible();
    await drawer
      .getByRole("button", { name: "Stage reviewed files (1)" })
      .click();
    await expect(
      page.getByText("1 reviewed file staged", { exact: true }),
    ).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: "Stage reviewed files (0)" }),
    ).toBeDisabled();
    await expect(
      drawer.getByRole("button", { name: "Stage all files (1)" }),
    ).toBeEnabled();

    await drawer.getByRole("button", { name: "Stage all files (1)" }).click();
    await expect(page.getByText("1 file staged", { exact: true })).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: "Commit 2 staged files" }),
    ).toBeEnabled();
  });

  test("runs grouped package commands and reconnects to their output", async ({
    page,
  }) => {
    await openFixture(page);
    await dismissPwaNotices(page);

    await page.getByRole("button", { name: "Open changed files" }).click();
    const drawer = page.getByRole("complementary", { name: "Changed files" });
    await drawer.getByRole("button", { name: /Commands/ }).click();
    await expect(drawer).toContainText("sample-project");
    await expect(drawer).toContainText("@sample/mobile");
    await expect(drawer).toContainText("expo export");
    await expect(drawer).toContainText("Only run commands");

    await drawer
      .getByRole("button", { name: "Run build in apps/mobile" })
      .click();
    const output = page.getByRole("dialog", { name: "Package command output" });
    await expect(output).toBeVisible();
    await expect(output).toContainText("pnpm run build");
    await expect(output).toContainText("fixture output: pnpm run build");
    await expect(output).toContainText("Passed");
    await output
      .getByRole("button", { name: "Close package command output" })
      .click();

    await page.getByRole("button", { name: "Open changed files" }).click();
    await expect(
      page
        .getByRole("complementary", { name: "Changed files" })
        .getByText("Active and recent runs"),
    ).toBeVisible();
  });

  test("switches projects through URL history while tabs remain independent", async ({
    context,
    page,
  }) => {
    await openFixture(page);
    await dismissPwaNotices(page);

    const repositoryButton = page.getByRole("button", { name: "Select repository" });
    await expect(repositoryButton).toContainText("sample-project");
    await repositoryButton.click();
    const picker = page.getByRole("dialog", { name: "Repositories" });
    await expect(picker).toContainText("/fixtures/sample-project");
    await expect(picker).toContainText("/fixtures/design-system");
    await picker.getByRole("button", { name: /design-system \/fixtures\/design-system/ }).click();
    await expect(repositoryButton).toContainText("design-system");
    await expect(page).toHaveURL(/\?repo=fixture-repository-two$/);

    await page.goBack();
    await expect(repositoryButton).toContainText("sample-project");
    await expect(page).toHaveURL(/\?repo=fixture-repository$/);

    const secondTab = await context.newPage();
    await secondTab.goto("/?repo=fixture-repository-two");
    await expect(secondTab.getByRole("button", { name: "Select repository" })).toContainText(
      "design-system",
    );
    await expect(repositoryButton).toContainText("sample-project");
    await secondTab.close();
  });

  test("landscape phones keep the viewer full width while the drawer overlays it", async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.includes("landscape"), "Landscape-only layout coverage.");
    await openFixture(page);
    await dismissPwaNotices(page);

    const workspace = page.getByRole("region", { name: "Unified diff" });
    const before = await workspace.boundingBox();
    expect(before).not.toBeNull();
    expect(before!.x).toBeLessThanOrEqual(1);
    expect(Math.abs(before!.width - (await page.evaluate(() => window.innerWidth)))).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Open changed files" }).click();
    const drawer = page.getByRole("complementary", { name: "Changed files" });
    await expect(drawer).toBeVisible();
    const after = await workspace.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.x).toBeCloseTo(before!.x, 0);
    expect(after!.width).toBeCloseTo(before!.width, 0);
    await expect(drawer).toHaveCSS("position", "fixed");
    await drawer.getByRole("button", { name: "Close changed files" }).click();

    const topBar = page.locator(".top-bar");
    const fileBar = page.locator(".file-bar");
    const actions = page.getByRole("navigation", { name: "Review actions" });
    await expect(fileBar).toHaveCount(0);
    await expect
      .poll(() => topBar.evaluate((element) => element.getBoundingClientRect().height))
      .toBeLessThanOrEqual(42);
    await expect(actions).toHaveCSS("position", "fixed");
    await expect
      .poll(() => actions.evaluate((element) => element.getBoundingClientRect().width))
      .toBeLessThan(360);
    await expect(actions.getByRole("button")).toHaveCount(4);
    await expect(page.locator(".compact-hunk-nav")).toBeVisible();
    await expect(page.locator(".compact-comments-button")).toBeVisible();

    const currentFile = page.getByRole("region", { name: "Current file" });
    await actions.getByRole("button", { name: "Review current file" }).click();
    await expect(currentFile).toContainText("src/review.ts");
    await expect(actions.getByRole("button", { name: "Unreview current file" })).toBeVisible();

    await actions.getByRole("button", { name: "Stage current file" }).click();
    await expect(actions.getByRole("button", { name: "Unstage current file" })).toBeVisible();
    await actions.getByRole("button", { name: "Unstage current file" }).click();
    await expect(actions.getByRole("button", { name: "Stage current file" })).toBeVisible();
  });
});

test.describe("production PWA", () => {
  test("has a valid manifest, an uncached live API, a disconnected shell, and update/install affordances", async ({
    browserName,
    context,
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Couchview");

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
      const repositoryId = new URL(location.href).searchParams.get("repo");
      if (!repositoryId) throw new Error("No repository selected");
      const response = await fetch(
        `/api/repositories/${encodeURIComponent(repositoryId)}/files`,
        { cache: "no-store" },
      );
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
    const cachePaths = cacheUrls.map((url) => new URL(url).pathname);
    expect(cachePaths).toContain("/index.html");
    expect(cachePaths.some((pathname) => /\/assets\/index-[^/]+\.js$/.test(pathname))).toBe(
      true,
    );
    expect(cachePaths.some((pathname) => /\/assets\/index-[^/]+\.css$/.test(pathname))).toBe(
      true,
    );
    for (const language of [
      "javascript",
      "typescript",
      "jsx",
      "tsx",
      "json",
      "css",
      "html",
      "markdown",
    ]) {
      expect(
        cachePaths.some((pathname) =>
          new RegExp(`/assets/${language}-[^/]+\\.js$`).test(pathname)
        ),
      ).toBe(true);
    }
    expect(cachePaths.some((pathname) => /\/assets\/cpp-[^/]+\.js$/.test(pathname))).toBe(
      false,
    );
    expect(
      cachePaths.some((pathname) =>
        pathname.includes("ghostty-web") || pathname.endsWith(".wasm")
      ),
    ).toBe(false);
    expect(cachePaths.length).toBeLessThan(20);

    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.defineProperties(event, {
        prompt: { value: async () => undefined },
        userChoice: { value: Promise.resolve({ outcome: "dismissed" }) },
      });
      window.dispatchEvent(event);
    });
    await expect(page.getByText("Install Couchview for full-screen access.")).toBeVisible();
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
          const repositoryId = new URL(location.href).searchParams.get("repo");
          await fetch(
            `/api/repositories/${encodeURIComponent(repositoryId ?? "missing")}/files`,
            { cache: "no-store" },
          );
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
        await expect(page).toHaveTitle("Couchview");
        await expect(page.getByRole("heading", { name: "Couldn’t open Couchview" })).toBeVisible();
      }
    } finally {
      await context.setOffline(false);
    }
  });
});
