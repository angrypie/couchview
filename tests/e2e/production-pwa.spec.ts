import { type BrowserContext, expect, type Page, type Request, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

async function expectButtonOpensUrl(
	context: BrowserContext,
	page: Page,
	name: string,
	expectedPath: string,
) {
	const expectedUrl = new URL(expectedPath, page.url()).href;
	const navigationUrls: string[] = [];
	const recordNavigation = (request: Request) => {
		if (request.isNavigationRequest()) navigationUrls.push(request.url());
	};
	context.on("request", recordNavigation);
	const openedPagePromise = context.waitForEvent("page");
	try {
		await page.getByRole("button", { name, exact: true }).click();
		const openedPage = await openedPagePromise;
		await expect.poll(() => navigationUrls).toContain(expectedUrl);
		await openedPage.close();
	} finally {
		context.off("request", recordNavigation);
	}
}

test.describe("production PWA", () => {
	test.beforeEach(async ({ request }) => {
		if (!localFixture) return;
		const response = await request.post("/api/e2e/reset", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(response.ok()).toBe(true);
	});

	test("guides an expired Cloudflare Access session back through sign-in", async ({
		context,
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
			"The Access recovery regression only needs one service-worker-capable browser.",
		);
		let requestedWith: string | undefined;
		await page.route("**/api/bootstrap", async (route) => {
			requestedWith = route.request().headers()["x-requested-with"];
			await route.fulfill({
				body: "Cloudflare Access sign-in required",
				contentType: "text/html",
				status: 401,
			});
		});

		await page.goto("/?repo=fixture-repository-two");
		await expect(page.getByRole("heading", { name: "Sign-in expired" })).toBeVisible();
		await expect(page.getByText("Sign in again to continue using Couchview.")).toBeVisible();
		await expectButtonOpensUrl(
			context,
			page,
			"Sign in again",
			"/api/access/refresh?repo=fixture-repository-two",
		);
		await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Reset app cache" })).toHaveCount(0);
		expect(requestedWith).toBe("XMLHttpRequest");
	});

	test("recognizes a missing Access cookie from its opaque login redirect", async ({
		context,
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
			"The missing-cookie regression targets Safari's cross-origin redirect behavior.",
		);
		await page.route("**/api/bootstrap", async (route) => {
			await route.continue({
				headers: {
					...route.request().headers(),
					"x-e2e-cloudflare-access-redirect": "1",
				},
			});
		});

		await page.goto("/?repo=fixture-repository-two");
		await expect(page.getByRole("heading", { name: "Sign-in expired" })).toBeVisible();
		await expectButtonOpensUrl(
			context,
			page,
			"Sign in again",
			"/api/access/refresh?repo=fixture-repository-two",
		);
	});

	test("stops an unsuccessful Access refresh from bouncing silently", async ({
		context,
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
			"The Access recovery regression only needs one service-worker-capable browser.",
		);
		await page.route("**/api/bootstrap", async (route) => {
			await route.fulfill({
				body: "Cloudflare Access sign-in required",
				contentType: "text/html",
				status: 401,
			});
		});

		await page.goto("/?repo=fixture-repository-two&access_refresh=1");
		await expect(page.getByRole("heading", { name: "Sign-in didn’t complete" })).toBeVisible();
		await expectButtonOpensUrl(context, page, "Reset Cloudflare sign-in", "/api/access/logout");
		await expectButtonOpensUrl(
			context,
			page,
			"Try sign-in again",
			"/api/access/refresh?repo=fixture-repository-two",
		);
		await expect(page).toHaveURL(/\?repo=fixture-repository-two$/);
	});

	test("guards dirty settings across browser Back", async ({ page }, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"The History API regression only needs one real Chromium project.",
		);
		await page.goto("/?repo=fixture-repository");
		await page.getByRole("button", { name: "Open settings" }).click();
		await expect(page).toHaveURL(/\/settings\?repo=fixture-repository$/);

		const wrap = page.getByRole("switch", { name: "Wrap long lines" });
		await expect(wrap).not.toBeChecked();
		await wrap.click();
		await expect(wrap).toBeChecked();
		await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
		expect(
			await page.evaluate(() => {
				const event = new Event("beforeunload", { cancelable: true });
				return { allowed: window.dispatchEvent(event), prevented: event.defaultPrevented };
			}),
		).toEqual({ allowed: false, prevented: true });

		const cancelDialog = page.waitForEvent("dialog");
		const cancelledBack = page.goBack();
		const cancel = await cancelDialog;
		expect(cancel.message()).toBe("Discard the unsaved profile changes and leave settings?");
		await cancel.dismiss();
		await cancelledBack;
		await expect(page).toHaveURL(/\/settings\?repo=fixture-repository$/);
		await expect(wrap).toBeChecked();
		await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();

		const confirmDialog = page.waitForEvent("dialog");
		const confirmedBack = page.goBack();
		const confirm = await confirmDialog;
		expect(confirm.message()).toBe("Discard the unsaved profile changes and leave settings?");
		await confirm.accept();
		await confirmedBack;
		await expect(page).toHaveURL(/\/\?repo=fixture-repository$/);
		await expect(page.getByRole("button", { name: "Open Git history" })).toBeVisible();
	});

	test("routes the universal RN-web surface through Expo without native-only controls", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
			"One browser is enough for the Expo web platform boundary.",
		);
		await page.goto("/settings?repo=fixture-repository");

		await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Manage paired servers" })).toHaveCount(0);
		await page.getByRole("button", { name: "Review", exact: true }).click();
		await expect(page).toHaveURL(/\/\?repo=fixture-repository$/);
		await expect(page.getByRole("button", { name: "Open command palette" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Open repository artifacts" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Open Git history" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Open settings" })).toBeVisible();
	});

	test("keeps documents and APIs network-only without prompting over unsaved work", async ({
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
			await expect
				.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
				.toBe(true);
		}

		const apiResponse = await page.evaluate(async () => {
			const repositoryId = new URL(location.href).searchParams.get("repo");
			if (!repositoryId) throw new Error("No repository selected");
			const response = await fetch(`/api/repositories/${encodeURIComponent(repositoryId)}/files`, {
				cache: "no-store",
			});
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
		expect(cachePaths).not.toContain("/index.html");
		expect(
			cachePaths.some((pathname) =>
				/\/_expo\/static\/js\/web\/__expo-metro-runtime-[^/]+\.js$/.test(pathname),
			),
		).toBe(true);
		expect(
			cachePaths.some((pathname) => /\/_expo\/static\/js\/web\/__common-[^/]+\.js$/.test(pathname)),
		).toBe(true);
		expect(
			cachePaths.some((pathname) => /\/_expo\/static\/js\/web\/entry-[^/]+\.js$/.test(pathname)),
		).toBe(true);
		expect(
			cachePaths.some((pathname) => /\/_expo\/static\/css\/native-[^/]+\.css$/.test(pathname)),
		).toBe(true);
		expect(
			cachePaths.some(
				(pathname) =>
					pathname.includes("ghostty-web") ||
					pathname.endsWith(".wasm") ||
					pathname.includes("Iosevka-"),
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
		await page.getByRole("button", { name: "Not now" }).click();

		await page.getByRole("button", { name: "Stage current file" }).click();
		await page.getByRole("button", { name: "Open changed files" }).click();
		await page.getByRole("button", { name: "Commit 1 staged file" }).click();
		await page.getByPlaceholder("Commit message…").fill("Unsaved update-guard draft");

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
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const registration = await navigator.serviceWorker.getRegistration("/");
					return registration?.waiting?.scriptURL ?? null;
				}),
			)
			.toContain("e2e-update=");
		await expect(page.getByText("An app update is ready.")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Reload" })).toHaveCount(0);
		await expect(page.getByPlaceholder("Commit message…")).toHaveValue(
			"Unsaved update-guard draft",
		);

		await context.setOffline(true);
		try {
			const apiOffline = await page.evaluate(async () => {
				try {
					const repositoryId = new URL(location.href).searchParams.get("repo");
					await fetch(`/api/repositories/${encodeURIComponent(repositoryId ?? "missing")}/files`, {
						cache: "no-store",
					});
					return false;
				} catch {
					return true;
				}
			});
			expect(apiOffline).toBe(true);
			// An already-loaded app stays mounted, but a new document navigation
			// must reach the network instead of receiving a cached app shell.
			await expect(page.getByRole("region", { name: "Current file" })).toBeVisible();
			const loadedOfflineDocument = await page
				.goto(`/?offline-check=${Date.now()}`, {
					timeout: 10_000,
					waitUntil: "domcontentloaded",
				})
				.then(
					() => true,
					() => false,
				);
			expect(loadedOfflineDocument).toBe(false);
		} finally {
			await context.setOffline(false);
			await page.goto("/");
		}
	});
});
