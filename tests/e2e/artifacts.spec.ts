import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

test.describe("repository artifacts", () => {
	test.skip(!localFixture, "The deterministic workflow uses the bundled e2e repository fixture.");

	test.beforeEach(async ({ page, request }) => {
		await page.addInitScript(() => {
			localStorage.setItem("couchview:install-hint-dismissed", "1");
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: async (text: string) => {
						localStorage.setItem("fixture-artifact-clipboard", text);
					},
				},
			});
		});
		const response = await request.post("/api/e2e/reset", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(response.ok()).toBe(true);
	});

	test("builds, reconnects, and downloads on iPhone and iPad", async ({ page }, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
			"Artifact delivery needs one representative mobile WebKit pass.",
		);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		await page.getByRole("button", { name: "Open repository artifacts" }).click();

		const workspace = page.getByRole("main", { name: "Repository artifacts" });
		await expect(workspace).toBeVisible();
		await expect(page).toHaveURL(/\/artifacts\?repo=fixture-repository$/);
		await expect(page.getByLabel("CLI device")).toContainText("Fixture Mac");
		await workspace.getByRole("button", { name: "Suggest artifact with Codex" }).click();
		const form = workspace.getByRole("form", { name: "Create artifact" });
		await expect(form.getByLabel("Name")).toHaveCSS("font-size", "16px");
		await form.getByLabel("What should this artifact produce?").fill("compile with Bun");
		await form.getByRole("button", { name: "Fill form" }).click();
		await expect(form.getByText("Codex filled an editable suggestion")).toBeVisible();
		await expect(form.getByText("Fixture suggestion using gpt-5.6-luna.")).toBeVisible();
		await expect(form.getByText("Read package.json")).toBeVisible();
		await form.getByLabel("Name").fill("mac-cli");
		await form.getByLabel("Command").fill("bun run build:cli");
		await form.getByLabel("Exact output path").fill("dist/couchview-cli");
		await form.getByRole("button", { name: "Create artifact" }).click();

		const card = workspace.getByRole("article").filter({ hasText: "mac-cli" });
		await expect(card).toBeVisible();
		await expect(card.getByText("bun run build:cli", { exact: true })).toBeVisible();
		await card.getByRole("button", { name: "Edit" }).click();
		const editForm = workspace.getByRole("form", { name: "Edit mac-cli artifact" });
		await editForm.getByLabel("Exact output path").fill("dist/couchview-mac");
		await editForm.getByRole("button", { name: "Save changes" }).click();
		await expect(card.getByText("dist/couchview-mac", { exact: true })).toBeVisible();

		await card.getByRole("button", { name: "Copy CLI command" }).click();
		await expect(page.getByText("Copied pull command for Fixture Mac")).toBeVisible();
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem("fixture-artifact-clipboard")))
			.toBe(
				"couchview artifacts pull mac-cli --profile couchview-fixture-device --repository fixture-repository",
			);

		await card.getByRole("button", { name: "Build" }).click();
		await expect(card.getByLabel("mac-cli build output")).toContainText(
			"fixture build started: bun run build:cli",
		);
		await page.reload();
		const reconnectedCard = page.getByRole("article").filter({ hasText: "mac-cli" });
		await expect(reconnectedCard.getByText("running", { exact: true })).toBeVisible();
		await expect(reconnectedCard.getByLabel("mac-cli build output")).toContainText(
			"fixture build started: bun run build:cli",
		);
		const downloadLink = reconnectedCard.getByRole("link", { name: "Download" });
		await expect(downloadLink).toBeVisible({ timeout: 10_000 });
		await expect(downloadLink).toHaveAttribute("download", "couchview-mac");
		await expect(downloadLink).toHaveAttribute(
			"href",
			/\/api\/repositories\/fixture-repository\/artifacts\/fixture-artifact-1\/builds\/fixture-artifact-build-1\/download$/,
		);
		const downloadPromise = page.waitForEvent("download");
		await downloadLink.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe("couchview-mac");
		const downloadPath = await download.path();
		expect(downloadPath).not.toBeNull();
		expect(await readFile(downloadPath!, "utf8")).toBe(
			"fixture artifact: mac-cli\noutput: dist/couchview-mac\n",
		);

		await expect
			.poll(() =>
				workspace.evaluate(() => ({
					overflow: document.documentElement.scrollWidth - window.innerWidth,
					width: window.innerWidth,
				})),
			)
			.toEqual({ overflow: 0, width: 390 });
		await page.setViewportSize({ width: 834, height: 1194 });
		await expect(workspace).toBeVisible();
		await expect(downloadLink).toBeInViewport();
		await expect
			.poll(() =>
				workspace.evaluate(() => ({
					overflow: document.documentElement.scrollWidth - window.innerWidth,
					width: window.innerWidth,
				})),
			)
			.toEqual({ overflow: 0, width: 834 });
	});
});
