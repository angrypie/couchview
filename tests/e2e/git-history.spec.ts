import { expect, type Page, test } from "@playwright/test";

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

async function expectSheetWithinViewport(page: Page) {
	const sheet = page.getByRole("dialog", { name: "Git history and repository actions" });
	await expect(sheet).toBeVisible();
	const viewport = await page.evaluate(() => ({
		height: window.innerHeight,
		width: window.innerWidth,
	}));
	await expect
		.poll(() =>
			sheet.evaluate((element) => {
				const bounds = element.getBoundingClientRect();
				return {
					bottom: Math.round(bounds.bottom),
					left: Math.round(bounds.left),
					right: Math.round(bounds.right),
				};
			}),
		)
		.toEqual({ bottom: viewport.height, left: 0, right: viewport.width });
	const bounds = await sheet.boundingBox();
	expect(bounds?.height ?? 0).toBeGreaterThan(viewport.height * 0.85);
}

test.describe("responsive Git workspace", () => {
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

	test("navigates history and actions across phone and iPad layouts", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
			"The responsive Git workspace needs one WebKit orientation cycle.",
		);

		await page.setViewportSize({ width: 390, height: 844 });
		await openFixture(page);
		await page.getByRole("button", { name: "Open Git history" }).click();
		await expectSheetWithinViewport(page);

		const commits = page.getByRole("region", { name: "Commit history" });
		const commitFiles = page.getByRole("region", { name: "Commit files" });
		const historicalDiff = page.getByRole("region", { name: "Historical diff" });
		await expect(commits).toBeVisible();
		await expect(commitFiles).toBeHidden();
		await commits.getByRole("button", { name: /Add mobile review workspace/ }).click();
		await expect(commits).toBeHidden();
		await expect(commitFiles).toBeVisible();
		await commitFiles.getByRole("button", { name: /src\/review\.ts/ }).click();
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
		await expectSheetWithinViewport(page);
		await expect(commitFiles).toBeVisible();
		await expect(commits).toBeHidden();

		await page.setViewportSize({ width: 834, height: 1194 });
		await expectSheetWithinViewport(page);
		await expect(commitFiles).toBeVisible();
		await expect(commits).toBeHidden();

		await page.setViewportSize({ width: 1194, height: 834 });
		const sheet = page.getByRole("dialog", { name: "Git history and repository actions" });
		await expect(sheet).toHaveCSS("left", "16px");
		await expect(commits).toBeVisible();
		await expect(commitFiles).toBeVisible();
		await expect(historicalDiff).toBeVisible();
		await expect
			.poll(() =>
				sheet.evaluate((element) => {
					const history = element.querySelector(".git-history-pane")!.getBoundingClientRect();
					const files = element.querySelector(".git-files-pane")!.getBoundingClientRect();
					const diff = element.querySelector(".git-diff-pane")!.getBoundingClientRect();
					return {
						historyBeforePreview: Math.round(history.right) === Math.round(files.left),
						previewAligned: Math.round(files.left) === Math.round(diff.left),
						previewWidthMatches: Math.round(files.width) === Math.round(diff.width),
						stackedPreview: Math.round(files.bottom) === Math.round(diff.top),
					};
				}),
			)
			.toEqual({
				historyBeforePreview: true,
				previewAligned: true,
				previewWidthMatches: true,
				stackedPreview: true,
			});

		await page.getByRole("button", { name: "Return", exact: true }).click();
		await expect(page.getByText(/Detached HEAD · previous branch/)).toHaveCount(0);
	});
});
