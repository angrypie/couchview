import { expect, type Locator, type Page, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

async function openFixture(page: Page) {
	await page.goto("/");
	await expect(page).toHaveTitle("Couchview");
	await expect(page.getByRole("region", { name: "Current file" })).toContainText("src/review.ts");
	for (const name of ["Dismiss", "Not now", "Later"]) {
		const buttons = await page.getByRole("button", { name, exact: true }).all();
		for (const button of buttons) {
			if (await button.isVisible()) await button.click();
		}
	}
}

async function expectPageWithinViewport(page: Page) {
	const historyPage = page.getByRole("main", { name: "Git history and repository actions" });
	await expect(historyPage).toBeVisible();
	const viewport = await page.evaluate(() => ({
		height: window.innerHeight,
		width: window.innerWidth,
	}));
	await expect
		.poll(() =>
			historyPage.evaluate((element) => {
				const bounds = element.getBoundingClientRect();
				return {
					bottom: Math.round(bounds.bottom),
					left: Math.round(bounds.left),
					right: Math.round(bounds.right),
					top: Math.round(bounds.top),
				};
			}),
		)
		.toEqual({ bottom: viewport.height, left: 0, right: viewport.width, top: 0 });
	const bounds = await historyPage.boundingBox();
	expect(bounds?.height ?? 0).toBeGreaterThan(viewport.height * 0.98);
}

async function expectCommitReviewSplit(commitFiles: Locator, historicalDiff: Locator) {
	const [filesBounds, diffBounds] = await Promise.all([
		commitFiles.boundingBox(),
		historicalDiff.boundingBox(),
	]);
	expect(filesBounds).not.toBeNull();
	expect(diffBounds).not.toBeNull();
	if (!filesBounds || !diffBounds) return;
	expect(Math.abs(filesBounds.x + filesBounds.width - diffBounds.x)).toBeLessThanOrEqual(2);
	expect(Math.abs(filesBounds.y - diffBounds.y)).toBeLessThanOrEqual(2);
	expect(Math.abs(filesBounds.height - diffBounds.height)).toBeLessThanOrEqual(2);
	expect(filesBounds.width).toBeGreaterThanOrEqual(298);
	expect(filesBounds.width).toBeLessThanOrEqual(302);
}

test.describe("responsive Git workspace", () => {
	test.skip(!localFixture, "The deterministic workflow uses the bundled e2e repository fixture.");

	test.beforeEach(async ({ page, request }) => {
		const response = await request.post("/api/e2e/reset", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(response.ok()).toBe(true);
	});

	test("navigates history and actions across phone and tablet layouts", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"The responsive Git workspace needs one mobile Chromium orientation cycle.",
		);

		await page.setViewportSize({ width: 390, height: 844 });
		await openFixture(page);
		await page.keyboard.press("g");
		await page.keyboard.press("h");
		await expect(page).toHaveURL(/\/history\?repo=fixture-repository$/);
		await page.reload();
		await expect(page).toHaveTitle("Couchview");
		await expect(page).toHaveURL(/\/history\?repo=fixture-repository$/);
		await expectPageWithinViewport(page);

		const commits = page.getByRole("region", { name: "Commit history" });
		const commitFiles = page.getByRole("region", { name: "Commit files" });
		const historicalDiff = page.getByRole("region", { name: "Historical diff" });
		await expect(commits).toBeVisible();
		await expect(commitFiles).toBeHidden();
		await commits.getByRole("button", { name: /Add mobile review workspace/ }).click();
		await expect(commits).toBeHidden();
		await expect(commitFiles).toBeVisible();
		await commitFiles.getByRole("button", { name: /benchmarks\/quality-checks\.json/ }).click();
		await expect(commitFiles).toBeHidden();
		await expect(historicalDiff).toBeVisible();
		await expect(historicalDiff.getByText("Read-only historical preview")).toBeVisible();
		await expect(
			historicalDiff.getByRole("button", { name: /^Select (old|new) line/ }),
		).toHaveCount(0);
		await expect(historicalDiff.getByRole("button", { name: /^Find “/ })).toHaveCount(0);

		await historicalDiff.getByRole("button", { name: "Back to commit files" }).click();
		await commitFiles.getByRole("button", { name: "Checkout" }).click();
		const blockedCheckout = page.getByRole("dialog", { name: "Checkout 0123456" });
		await expect(blockedCheckout).toContainText(
			"blocked because the repository has 2 changed files",
		);
		await expect(blockedCheckout.getByRole("button", { name: "Checkout commit" })).toBeDisabled();
		await blockedCheckout.getByRole("button", { name: "Stash changes…" }).click();
		const stash = page.getByRole("dialog", { name: "Stash repository changes" });
		await stash.getByRole("button", { name: "Stash changes", exact: true }).click();
		await expect(page.getByText("Repository changes stashed")).toBeVisible();

		await commitFiles.getByRole("button", { name: "Checkout" }).click();
		const checkout = page.getByRole("dialog", { name: "Checkout 0123456" });
		await expect(checkout.getByRole("button", { name: "Checkout commit" })).toBeEnabled();
		await checkout.getByRole("button", { name: "Checkout commit" }).click();
		await expect(
			page.getByText(/Detached HEAD · previous branch feature\/mobile-review/),
		).toBeVisible();

		await page.setViewportSize({ width: 844, height: 390 });
		await expectPageWithinViewport(page);
		await expect(commits).toBeHidden();
		await expect(commitFiles).toBeVisible();
		await expect(historicalDiff).toBeHidden();

		await page.setViewportSize({ width: 834, height: 1194 });
		await expectPageWithinViewport(page);
		await expect(commits).toBeHidden();
		await expect(commitFiles).toBeVisible();
		await expect(historicalDiff).toBeHidden();

		await page.setViewportSize({ width: 1194, height: 834 });
		const historyPage = page.getByRole("main", { name: "Git history and repository actions" });
		await expectPageWithinViewport(page);
		await expect(commits).toBeHidden();
		await expect(commitFiles).toBeVisible();
		await expect(historicalDiff).toBeVisible();
		await expectCommitReviewSplit(commitFiles, historicalDiff);
		await commitFiles.getByRole("button", { name: /benchmarks\/quality-checks\.json/ }).click();
		await expect(historicalDiff.getByText("Read-only historical preview")).toBeVisible();

		await page.getByRole("button", { name: "Return", exact: true }).click();
		await expect(page.getByText(/Detached HEAD · previous branch/)).toHaveCount(0);
		await historyPage.getByRole("button", { name: "History", exact: true }).click();
		await expect(commits).toBeVisible();
		await expect(commitFiles).toBeHidden();
		await expect(historicalDiff).toBeHidden();
		await historyPage.getByRole("button", { name: "Review", exact: true }).click();
		await expect(page).toHaveURL(/\/\?repo=fixture-repository$/);
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
	});
});
