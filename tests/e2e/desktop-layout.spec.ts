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
		const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
		await expect(palette).toBeVisible();
		await expect(palette.getByRole("button", { name: /^Open command palette/ })).toHaveCount(0);
		await palette.getByRole("textbox", { name: "Search commands" }).fill("package");
		await palette.getByRole("button", { name: /^Open package commands/ }).click();
		await expect(palette).toHaveCount(0);
		await expect(page.getByRole("heading", { name: "Package commands" })).toBeVisible();

		await page.getByRole("button", { name: "Open command palette" }).click();
		await palette.getByRole("textbox", { name: "Search commands" }).fill("settings");
		await palette.getByRole("button", { name: /^Go to settings/ }).click();
		const settings = page.getByRole("region", { name: "Settings" });
		await expect(settings).toBeVisible();
		await expect(page).toHaveURL(/\/settings/);
	});

	test("applies and persists a device-local color theme", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/settings");

		const settings = page.getByRole("region", { name: "Settings" });
		const save = settings.getByRole("button", { name: "Save changes" });
		await expect(settings.getByRole("radio", { name: "System", exact: true })).toBeChecked();

		await settings.getByRole("radio", { name: "Light", exact: true }).click();
		await expect(settings.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
		await expect(save).toBeDisabled();

		await page.reload();
		await expect(settings.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
		await settings.getByRole("button", { name: "Review", exact: true }).click();
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();

		await page.getByRole("button", { name: "Open settings" }).click();
		await settings.getByRole("radio", { name: "Dark", exact: true }).click();
		await expect(settings.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
		await expect(save).toBeDisabled();
		await page.reload();
		await expect(settings.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
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
		const currentFile = page.getByRole("region", { name: "Current file" });
		const commandTrigger = page.getByRole("button", { name: "Open command palette" });
		const stageAll = drawer.getByRole("button", { name: "Stage all files (30)" });
		const importantPath =
			"src/generated/with/a/very/long/directory/that/must/not/hide/file-28-important-name.ts";
		const importantFile = drawer.getByRole("button", { name: importantPath });

		await expect(page.getByRole("button", { name: "Previous file" })).toHaveCount(1);
		await expect(page.getByRole("button", { name: "Next file" })).toHaveCount(1);
		await expect(currentFile.getByRole("button", { name: "Previous file" })).toHaveCount(0);
		await expect(currentFile.getByRole("button", { name: "Next file" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Open repository artifacts" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Open Git history" })).toBeVisible();
		await expect(commandTrigger).toBeVisible();
		await expect(page.getByRole("button", { name: "Review + next" })).toBeVisible();
		await expect(stageAll).toBeInViewport();
		await expect(importantFile).toBeAttached();

		const listMetrics = await drawer.evaluate((element) => {
			const candidates = [element, ...element.querySelectorAll<HTMLElement>("*")];
			const fileList = candidates.find((candidate) => {
				const { overflowY } = getComputedStyle(candidate);
				return (
					(overflowY === "auto" || overflowY === "scroll") &&
					candidate.scrollHeight > candidate.clientHeight
				);
			});
			if (!fileList)
				throw new Error("Changed files did not provide an independently scrollable list");
			const metrics = {
				clientHeight: fileList.clientHeight,
				scrollHeight: fileList.scrollHeight,
				horizontalOverflow: fileList.scrollWidth - fileList.clientWidth,
			};
			fileList.scrollTop = fileList.scrollHeight;
			return metrics;
		});
		expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight);
		expect(listMetrics.horizontalOverflow).toBeLessThanOrEqual(1);
		await expect(importantFile).toBeInViewport();
		await expect(stageAll).toBeInViewport();
	});

	test("pairs apps and native IDEs without overflowing the desktop sheet", async ({ page }) => {
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
		const sheet = page.getByRole("dialog", { name: "Native IDE", exact: true });
		const dialog = sheet.getByRole("dialog", { name: "Native IDE setup", exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText("Couchview app", { exact: true })).toBeVisible();
		await expect(dialog.getByText("Fixture iPhone", { exact: true })).toBeVisible();
		await dialog.getByRole("button", { name: "Generate app pairing" }).click();
		await expect(
			dialog.getByRole("img", { name: "QR code for Couchview app pairing" }),
		).toBeVisible();
		await expect(
			dialog.getByText(/couchview:\/\/pair\?protocol=couchview-native-v1/),
		).toBeVisible();
		await expect(dialog.getByText("Direct WebRTC preferred")).toBeVisible();
		await expect(
			dialog.getByRole("button", {
				name: "Open /fixtures/sample-project in Zed through MacBook Air",
			}),
		).toBeVisible();
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
				const nextBounds = await sheet.boundingBox();
				return nextBounds ? nextBounds.y + nextBounds.height : Number.POSITIVE_INFINITY;
			})
			.toBeLessThanOrEqual(800);
		const bounds = await sheet.boundingBox();
		expect(bounds).not.toBeNull();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);

		const deviceName = dialog.getByRole("textbox", { name: "Device name" });
		await deviceName.scrollIntoViewIfNeeded();
		await expect(deviceName).toBeInViewport();
		await deviceName.fill("Travel Air");
		const generateMacPairing = dialog.getByRole("button", { name: "Generate", exact: true });
		await generateMacPairing.scrollIntoViewIfNeeded();
		await expect(generateMacPairing).toBeInViewport();
		await generateMacPairing.click();
		await expect(dialog.getByText(/couchview bridge pair/)).toBeVisible();
		expect(pairingRequest).toEqual({ csrf: fixtureCsrf, label: "Travel Air" });

		page.once("dialog", (confirmation) => void confirmation.accept());
		const revokeMac = dialog.getByRole("button", { name: "Revoke MacBook Air" });
		await revokeMac.scrollIntoViewIfNeeded();
		await revokeMac.click();
		await expect(dialog.getByText("No development Macs are paired yet.")).toBeVisible();
		expect(revokedDevice).toBe(device.id);

		page.once("dialog", (confirmation) => void confirmation.accept());
		const revokeApp = dialog.getByRole("button", { name: "Revoke app access for Fixture iPhone" });
		await revokeApp.scrollIntoViewIfNeeded();
		await revokeApp.click();
		await expect(dialog.getByText("No Couchview apps are paired yet.")).toBeVisible();
	});
});
