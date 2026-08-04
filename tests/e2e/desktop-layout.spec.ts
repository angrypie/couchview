import { expect, test } from "@playwright/test";

import type {
	BootstrapResponse,
	ChangesResponse,
	RemoteBridgeDevice,
} from "../../src/shared/contracts.ts";

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

	test("opens the command palette by keyboard and executes a filtered command", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();

		await page.keyboard.press("Control+k");
		const palette = page.getByRole("dialog", { name: "Couchview command palette" });
		await expect(palette).toBeVisible();
		await expect(palette.getByText("Open command palette")).toHaveCount(0);
		await palette.getByRole("combobox", { name: "Couchview command palette" }).fill("package");
		await palette.getByText("Open package commands", { exact: true }).click();
		await expect(palette).toHaveCount(0);
		await expect(page.getByRole("heading", { name: "Package commands" })).toBeVisible();

		await page.getByRole("button", { name: "Open command palette" }).click();
		await palette.getByRole("combobox", { name: "Couchview command palette" }).fill("settings");
		await palette.getByText("Go to settings", { exact: true }).click();
		await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
		await expect(page).toHaveURL(/\/settings/);
	});

	test("keeps filenames and controls visible while the changed-files list scrolls", async ({
		page,
	}) => {
		await page.route("**/api/repositories/*/files", async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as ChangesResponse;
			const template = body.files.at(-1)!;
			const extraFiles = Array.from({ length: 28 }, (_, index) => ({
				...template,
				id: `fixture-extra-${index + 1}`,
				path:
					index === 27
						? "src/generated/with/a/very/long/directory/that/must/not/hide/file-28-important-name.ts"
						: `src/generated/file-${String(index + 1).padStart(2, "0")}.ts`,
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
		const currentFile = page.getByRole("region", { name: "Current file" });
		const commandTrigger = page.getByRole("button", { name: "Open command palette" });
		const reviewAction = page.getByRole("button", { name: "Review + next" });

		await expect(page.getByRole("button", { name: "Previous file" })).toHaveCount(1);
		await expect(page.getByRole("button", { name: "Next file" })).toHaveCount(1);
		await expect(currentFile.getByRole("button", { name: "Previous file" })).toHaveCount(0);
		await expect(currentFile.getByRole("button", { name: "Next file" })).toHaveCount(0);
		await expect(page.locator(".artifacts-launch-button .lucide-archive")).toBeVisible();
		await expect(page.locator(".git-history-launch-button .lucide-git-graph")).toBeVisible();
		await expect
			.poll(() => reviewAction.evaluate((element) => element.getBoundingClientRect().width))
			.toBeLessThanOrEqual(420);
		await expect
			.poll(() =>
				commandTrigger.evaluate((element) => {
					const icon = element.querySelector("svg")?.getBoundingClientRect();
					const shortcut = element.querySelector("kbd")?.getBoundingClientRect();
					if (!icon || !shortcut) return 99;
					return Math.abs(icon.top + icon.height / 2 - (shortcut.top + shortcut.height / 2));
				}),
			)
			.toBeLessThanOrEqual(1);

		await expect(drawer.getByRole("button", { name: "Stage all files (30)" })).toBeVisible();
		await expect(footer).toBeVisible();
		await expect
			.poll(() =>
				fileList.evaluate((element) => ({
					clientHeight: element.clientHeight,
					scrollHeight: element.scrollHeight,
					overflowY: getComputedStyle(element).overflowY,
				})),
			)
			.toMatchObject({ overflowY: "auto" });

		const listMetrics = await fileList.evaluate((element) => ({
			clientHeight: element.clientHeight,
			scrollHeight: element.scrollHeight,
		}));
		expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight);

		const footerBottom = await footer.evaluate((element) => element.getBoundingClientRect().bottom);
		expect(footerBottom).toBeLessThanOrEqual(800);

		await fileList.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		await expect.poll(() => fileList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
		const importantName = drawer.getByText("file-28-important-name.ts", { exact: true });
		await expect(importantName).toBeVisible();
		await expect(importantName).toHaveCSS("font-size", "12px");
		await expect
			.poll(() => fileList.evaluate((element) => element.scrollWidth - element.clientWidth))
			.toBeLessThanOrEqual(0);
	});

	test("pairs and revokes a native IDE without overflowing the desktop sheet", async ({ page }) => {
		const device: RemoteBridgeDevice = {
			id: "fixture-device-one",
			repositoryId: "fixture-repository",
			label: "MacBook Air",
			sshAlias: "couchview-fixture-device",
			createdAt: "2026-07-29T10:00:00.000Z",
			lastUsedAt: null,
		};
		let devices = [device];
		let pairingRequest: { csrf: string | null; label: string } | null = null;
		let revokedDevice = "";

		await page.route("**/api/bootstrap", async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as BootstrapResponse;
			await route.fulfill({
				response,
				json: {
					...body,
					remoteBridge: {
						available: true,
						reason: null,
						p2pEnabled: true,
					},
				} satisfies BootstrapResponse,
			});
		});
		await page.route("**/api/repositories/*/remote-bridge/pairings**", async (route) => {
			const request = route.request();
			if (request.method() === "GET") {
				await route.fulfill({ json: { devices } });
				return;
			}
			if (request.method() === "POST") {
				const body = request.postDataJSON() as { label: string };
				pairingRequest = {
					csrf: request.headers()["x-couchview-csrf"] ?? null,
					label: body.label,
				};
				await route.fulfill({
					status: 201,
					json: {
						command:
							"couchview bridge pair --url 'https://review.example.com' --code 'fixture-code' --cloudflare-access",
						expiresAt: "2099-07-29T10:05:00.000Z",
						sshAlias: "couchview-fixture-new-device",
					},
				});
				return;
			}
			if (request.method() === "DELETE") {
				revokedDevice = decodeURIComponent(new URL(request.url()).pathname.split("/").at(-1) ?? "");
				devices = devices.filter((candidate) => candidate.id !== revokedDevice);
				await route.fulfill({ status: 204, body: "" });
				return;
			}
			await route.fallback();
		});

		await page.goto("/");
		await page.getByRole("button", { name: "Set up native IDE" }).click();
		const dialog = page.getByRole("dialog", { name: "Native IDE setup" });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText("Direct WebRTC preferred")).toBeVisible();
		const zedLink = dialog.getByRole("link", { name: "Open" });
		await expect(zedLink).toHaveAttribute(
			"href",
			"zed://ssh/couchview-fixture-device/fixtures/sample-project",
		);
		await expect(
			dialog.getByText("zed 'ssh://couchview-fixture-device/fixtures/sample-project'", {
				exact: true,
			}),
		).toBeVisible();
		await expect(
			dialog.getByText(
				"couchview bridge codex --profile couchview-fixture-device --repo '/fixtures/sample-project'",
				{ exact: true },
			),
		).toBeVisible();
		await expect(
			dialog.getByText(
				"couchview bridge terminal --profile couchview-fixture-device --repo '/fixtures/sample-project'",
				{ exact: true },
			),
		).toBeVisible();
		await expect(
			dialog.getByText(
				"couchview bridge claude --profile couchview-fixture-device --repo '/fixtures/sample-project'",
				{ exact: true },
			),
		).toBeVisible();
		await expect
			.poll(async () => {
				const nextBounds = await dialog.boundingBox();
				return nextBounds ? nextBounds.y + nextBounds.height : Number.POSITIVE_INFINITY;
			})
			.toBeLessThanOrEqual(800);
		const bounds = await dialog.boundingBox();
		expect(bounds).not.toBeNull();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);

		await dialog.getByLabel("Device name").fill("Travel Air");
		await dialog.getByRole("button", { name: "Generate" }).click();
		await expect(dialog.getByText(/couchview bridge pair/)).toBeVisible();
		expect(pairingRequest).toEqual({ csrf: fixtureCsrf, label: "Travel Air" });

		page.once("dialog", (confirmation) => void confirmation.accept());
		await dialog.getByRole("button", { name: "Revoke MacBook Air" }).click();
		await expect(dialog.getByText("No development Macs are paired yet.")).toBeVisible();
		expect(revokedDevice).toBe(device.id);
	});
});
