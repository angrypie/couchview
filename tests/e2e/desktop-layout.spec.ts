import { expect, type Page, test } from "@playwright/test";

import type {
	BootstrapResponse,
	ChangesResponse,
	ProjectFilesResponse,
	RemoteBridgeDevice,
} from "../../src/shared/contracts.ts";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

async function primaryModifier(page: Page): Promise<"Control" | "Meta"> {
	return page.evaluate(() => {
		const userAgentData = (
			navigator as Navigator & {
				userAgentData?: { platform?: string };
			}
		).userAgentData;
		const platform = userAgentData?.platform || navigator.platform || navigator.userAgent;
		return /Mac|iPhone|iPad|iPod/i.test(platform) ? "Meta" : "Control";
	});
}

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

	test("keeps the quick project picker focused and stable while filtering", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();

		await page.keyboard.press("g");
		await page.keyboard.press("p");
		const picker = page.getByRole("dialog", { name: "Projects" });
		const search = picker.getByRole("textbox", { name: "Search projects" });
		await expect(picker).toBeVisible();
		await expect(search).toBeFocused();
		const initialBounds = await picker.boundingBox();
		expect(initialBounds).not.toBeNull();

		await search.fill("design");
		await expect(
			picker.getByRole("button", { name: "design-system, /fixtures/design-system" }),
		).toBeVisible();
		const filteredBounds = await picker.boundingBox();
		expect(filteredBounds).not.toBeNull();
		expect(Math.abs(filteredBounds!.width - initialBounds!.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(filteredBounds!.height - initialBounds!.height)).toBeLessThanOrEqual(1);
		expect(Math.abs(filteredBounds!.x - initialBounds!.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(filteredBounds!.y - initialBounds!.y)).toBeLessThanOrEqual(1);

		await page.keyboard.press("Control+c");
		await expect(picker).toHaveCount(0);

		await page.keyboard.press("g");
		await page.keyboard.press("p");
		await picker.getByRole("textbox", { name: "Search projects" }).fill("design");
		await page.keyboard.press("Enter");
		await expect
			.poll(() => Object.fromEntries(new URL(page.url()).searchParams))
			.toEqual({ file: "src/review.ts", repo: "fixture-repository-two" });
		await expect(page.getByRole("button", { name: "Select repository" })).toContainText(
			"design-system",
		);
	});

	test("replaces the quick project picker with the command palette", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();

		await page.keyboard.press("g");
		await page.keyboard.press("p");
		const projectPicker = page.getByRole("dialog", { name: "Projects" });
		await expect(projectPicker).toBeVisible();

		const primary = await primaryModifier(page);
		await page.keyboard.press(`${primary}+k`);
		const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
		await expect(palette).toBeVisible();
		await expect(projectPicker).toHaveCount(0);

		await page.keyboard.press("Escape");
		await expect(palette).toHaveCount(0);
		await expect(projectPicker).toHaveCount(0);
	});

	test("cycles projects with held G and opens current-project files with Ctrl+P", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();

		await page.keyboard.down("g");
		await page.keyboard.press("p");
		const projectPicker = page.getByRole("dialog", { name: "Projects" });
		const currentProject = projectPicker.getByRole("button", {
			name: "sample-project, /fixtures/sample-project",
		});
		const alternateProject = projectPicker.getByRole("button", {
			name: "design-system, /fixtures/design-system",
		});
		await expect(currentProject).toHaveAttribute("aria-selected", "true");
		await expect(projectPicker.getByRole("status")).toContainText("sample-project");
		await page.keyboard.down("g");
		await expect(projectPicker.getByRole("textbox", { name: "Search projects" })).toHaveValue("");
		await page.keyboard.press("p");
		await expect(alternateProject).toHaveAttribute("aria-selected", "true");
		await page.keyboard.press("p");
		await expect(currentProject).toHaveAttribute("aria-selected", "true");
		await page.keyboard.up("g");
		await page.keyboard.press("Control+c");
		await expect(projectPicker).toHaveCount(0);

		await page.keyboard.press("g");
		await page.keyboard.press("p");
		const manageProjects = projectPicker.getByRole("button", { name: "Manage projects…" });
		await manageProjects.focus();
		await page.keyboard.press("Enter");
		const repositoryManager = page.getByRole("dialog", { name: "Repositories" });
		await expect(repositoryManager).toBeVisible();
		await repositoryManager.getByRole("button", { name: "Close sheet" }).click();
		await expect(repositoryManager).toHaveCount(0);

		await page.keyboard.press("Control+p");
		const filePicker = page.getByRole("dialog", { name: "Files" });
		const fileSearch = filePicker.getByRole("textbox", { name: "Search project files" });
		await expect(filePicker).toBeVisible();
		await expect(fileSearch).toBeFocused();
		await expect(filePicker.getByRole("button", { name: "README.md, Project root" })).toBeVisible();
		const repeatPrevented = await fileSearch.evaluate((input) => {
			const event = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				ctrlKey: true,
				key: "p",
				repeat: true,
			});
			input.dispatchEvent(event);
			return event.defaultPrevented;
		});
		expect(repeatPrevented).toBe(true);
		await fileSearch.fill("format");
		await page.keyboard.press("Enter");
		await expect(filePicker).toHaveCount(0);
		await expect(page.getByRole("region", { name: "Current file" })).toContainText("src/format.ts");

		await page.keyboard.press("Control+p");
		await expect(filePicker).toBeVisible();
		await fileSearch.fill("readme");
		await page.keyboard.press("Enter");
		await expect(filePicker).toHaveCount(0);
		const sourceFile = page.getByRole("region", { name: "Current file" });
		await expect(sourceFile).toContainText("README.md");
		await expect(sourceFile).toContainText("read-only");
		await expect(page.getByRole("region", { name: "Unified diff" })).toContainText(
			"export function fixture()",
		);
	});

	test("resets equal-sized fuzzy file results to their active first row", async ({ page }) => {
		await page.route("**/api/repositories/*/project-files", async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as ProjectFilesResponse;
			const files = ["alpha", "beta"].flatMap((group) =>
				Array.from({ length: 40 }, (_, index) => ({
					path: `src/${group}/item-${String(index).padStart(2, "0")}.ts`,
				})),
			);
			await route.fulfill({ response, json: { ...body, files } });
		});
		await page.goto("/");
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();

		await page.keyboard.press("Control+p");
		const picker = page.getByRole("dialog", { name: "Files" });
		const search = picker.getByRole("textbox", { name: "Search project files" });
		const results = picker.getByTestId("quick-picker-results");
		await search.fill("alpha");
		await expect(picker.getByRole("button", { name: "item-00.ts, src/alpha" })).toBeVisible();
		await results.evaluate((element) => {
			element.scrollTop = 560;
			element.dispatchEvent(new Event("scroll", { bubbles: true }));
		});
		await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(400);

		await search.fill("beta");
		const activeFirstRow = picker.getByRole("button", { name: "item-00.ts, src/beta" });
		await expect(activeFirstRow).toHaveAttribute("aria-selected", "true");
		await expect(activeFirstRow).toBeInViewport();
		await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeLessThan(60);
	});

	test("ranks a contiguous filename match ahead of cross-directory fuzzy noise", async ({
		page,
	}) => {
		const distractorPath = "apps/native/src/app/conversations/[id].tsx";
		const targetPath = "apps/native/src/features/audio/transcription.ios.ts";
		await page.route("**/api/repositories/*/project-files", async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as ProjectFilesResponse;
			await route.fulfill({
				response,
				json: {
					...body,
					files: [{ path: distractorPath }, { path: targetPath }],
				},
			});
		});
		await page.goto("/");
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();

		await page.keyboard.press("Control+p");
		const picker = page.getByRole("dialog", { name: "Files" });
		const search = picker.getByRole("textbox", { name: "Search project files" });
		await expect(
			picker.getByRole("button", {
				name: "transcription.ios.ts, apps/native/src/features/audio",
			}),
		).toBeVisible();
		await search.fill("trans ios");

		const results = picker.getByTestId("quick-picker-results");
		const target = results.getByRole("button", {
			name: "transcription.ios.ts, apps/native/src/features/audio",
		});
		await expect(target).toHaveAttribute("aria-selected", "true");
		await expect(results.getByRole("button").first()).toHaveAccessibleName(
			"transcription.ios.ts, apps/native/src/features/audio",
		);

		await page.keyboard.press("Enter");
		await expect(picker).toHaveCount(0);
		const currentFile = page.getByRole("region", { name: "Current file" });
		await expect(currentFile).toContainText(targetPath);
		await expect(currentFile).toContainText("read-only");
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
