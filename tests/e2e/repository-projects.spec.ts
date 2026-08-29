import { expect, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

test.describe("repository projects", () => {
	test.skip(!localFixture, "The deterministic workflow uses the bundled e2e repository fixture.");

	test.beforeEach(async ({ page, request }) => {
		const response = await request.post("/api/e2e/reset", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(response.ok()).toBe(true);
	});

	test("chooses and adds a server folder from the repository picker", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"One mobile Chromium pass covers the compact project form.",
		);
		let submittedRoot: string | null = null;
		await page.route("**/api/repository-directories**", async (route) => {
			const requestedPath = new URL(route.request().url()).searchParams.get("path");
			await route.fulfill({
				contentType: "application/json",
				status: 200,
				body: JSON.stringify(
					requestedPath === "/fixtures/design-system"
						? {
								directories: [],
								parent: "/fixtures",
								path: requestedPath,
								truncated: false,
							}
						: {
								directories: [{ name: "design-system", path: "/fixtures/design-system" }],
								parent: "/",
								path: "/fixtures",
								truncated: false,
							},
				),
			});
		});
		await page.route("**/api/repositories", async (route) => {
			if (route.request().method() !== "POST") {
				await route.fallback();
				return;
			}
			submittedRoot = (route.request().postDataJSON() as { root: string }).root;
			await route.fulfill({
				contentType: "application/json",
				status: 201,
				body: JSON.stringify({
					added: true,
					repository: {
						id: "fixture-repository-two",
						name: "design-system",
						root: "/fixtures/design-system",
						available: true,
						addedAt: "2026-01-01T00:00:00.000Z",
					},
				}),
			});
		});

		await page.goto("/");
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
		await page.getByRole("button", { name: "Select repository" }).click();
		const quickPicker = page.getByRole("dialog", { name: "Projects" });
		await quickPicker.getByRole("button", { name: "Manage projects…" }).click();
		const picker = page.getByRole("dialog", { name: "Repositories" });
		await expect(picker).toBeInViewport();
		await picker.getByRole("button", { name: "Browse server folders" }).click();
		const directoryPicker = page.getByRole("dialog", { name: "Choose project folder" });
		await expect(directoryPicker).toBeInViewport();
		await expect(directoryPicker).toContainText("/fixtures");
		await directoryPicker.getByRole("button", { name: "design-system" }).click();
		await expect(directoryPicker).toContainText("/fixtures/design-system");
		await directoryPicker.getByRole("button", { name: "Add this project" }).click();

		await expect(page.getByRole("button", { name: "Select repository" })).toContainText(
			"design-system",
		);
		await expect(page).toHaveURL(/\?repo=fixture-repository-two$/);
		expect(submittedRoot).toBe("/fixtures/design-system");
	});
});
