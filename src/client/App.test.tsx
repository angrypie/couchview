import { describe, expect, test } from "bun:test";
import {
	App,
	act,
	cleanup,
	createAppTestHarness,
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
	FakeTerminalWebSocket,
	fireEvent,
	previewRendererState,
	render,
	rendererState,
	screen,
	waitFor,
	within,
} from "./appTestHarness.tsx";

describe("Couchview app lifecycle and settings", () => {
	const fixture = createAppTestHarness();
	test("applies a safe launch update silently", async () => {
		fixture.pwaNeedRefresh = true;
		render(<App />);

		await waitFor(() => expect(fixture.pwaUpdateCalls).toBe(1));
		expect(screen.queryByText("An app update is ready.")).toBeNull();
	});

	test("keeps the update prompt when Settings may contain unapplied changes", async () => {
		window.history.replaceState(null, "", "/settings");
		const view = render(<App />);

		await screen.findByRole("region", { name: "Settings" });
		fireEvent.change(screen.getAllByLabelText("Font size")[0]!, {
			target: { value: "14" },
		});
		fixture.pwaNeedRefresh = true;
		view.rerender(<App />);
		expect(screen.getByText("An app update is ready.")).toBeTruthy();
		expect(fixture.pwaUpdateCalls).toBe(0);
	});

	test("resizes, reviews and advances, then navigates back", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		expect(screen.getByText("11px")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Increase diff font size" }));
		expect(screen.getByText("12px")).toBeTruthy();
		await waitFor(() =>
			expect(fixture.settingsProfiles[0]?.data.typography.diff.fontSize).toBe(12),
		);

		fireEvent.click(screen.getByRole("button", { name: /Review \+ next/ }));
		await waitFor(() => expect(screen.getByText("src/second.ts")).toBeTruthy());
		expect(
			fixture.requests.some(
				(request) => request.path === "/api/repositories/repo/files/first/review",
			),
		).toBe(true);
		fireEvent.click(screen.getAllByRole("button", { name: "Previous file" })[0]!);
		await waitFor(() => expect(screen.getByText("src/first.ts")).toBeTruthy());
	});

	test("offers a network-only sign-in path when the secure session expires", async () => {
		fixture.bootstrapFailureStatus = 401;
		window.history.replaceState(null, "", "/?repo=repo-two");
		render(<App />);

		await screen.findByRole("heading", { name: "Sign-in expired" });
		expect(screen.getByText("Sign in again to continue using Couchview.")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe(
			"/api/access/refresh?repo=repo-two",
		);
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Reset app cache" })).toBeNull();
	});

	test("stops a completed Access sign-in from silently looping", async () => {
		fixture.bootstrapFailureStatus = 401;
		window.history.replaceState(null, "", "/?repo=repo-two&access_refresh=1");
		render(<App />);

		await screen.findByRole("heading", { name: "Sign-in didn’t complete" });
		expect(
			screen.getByText(
				"Cloudflare returned to Couchview, but this browser still does not have a usable Access session.",
			),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Reset Cloudflare sign-in" }).getAttribute("href"),
		).toBe("/api/access/logout");
		expect(screen.getByRole("link", { name: "Try sign-in again" }).getAttribute("href")).toBe(
			"/api/access/refresh?repo=repo-two",
		);
		expect(window.location.search).toBe("?repo=repo-two");
	});

	test("offers sign-in, retry, and app-cache recovery for a connection failure", async () => {
		globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
		render(<App />);

		await screen.findByRole("heading", { name: "Couchview is unavailable" });
		expect(screen.getByText("Could not reach Couchview.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reset app cache" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe(
			"/api/access/refresh",
		);
	});

	test("does not suggest authentication or cache recovery for a server response", async () => {
		fixture.bootstrapFailureStatus = 503;
		render(<App />);

		await screen.findByRole("heading", { name: "Couldn’t open Couchview" });
		expect(screen.getByText("Request failed (503)")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Reset app cache" })).toBeNull();
		expect(screen.queryByRole("link", { name: "Sign in again" })).toBeNull();
	});

	test("preserves tmux across Review and applies terminal settings only once", async () => {
		fixture.terminalAvailable = true;
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Increase diff font size" }));
		fireEvent.click(screen.getByRole("button", { name: "Open tmux terminal" }));

		await waitFor(() => expect(rendererState.calls).toBe(1));
		await waitFor(() =>
			expect(
				fixture.requests.some(
					(request) =>
						request.path === "/api/repositories/repo/terminal/attachments" &&
						request.method === "POST",
				),
			).toBe(true),
		);
		expect(
			fixture.requests.find(
				(request) => request.path === "/api/repositories/repo/terminal/attachments",
			),
		).toMatchObject({
			body: {
				profileId: "tmux",
			},
		});
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		expect(document.querySelector("main.app-shell")?.classList.contains("terminal-active")).toBe(
			true,
		);

		fireEvent.click(screen.getByRole("button", { name: "Review" }));
		expect(document.querySelector("main.app-shell")?.classList.contains("terminal-active")).toBe(
			false,
		);
		expect(document.querySelector(".terminal-workspace")?.getAttribute("aria-hidden")).toBe("true");
		expect(screen.getByText("12px")).toBeTruthy();
		expect(rendererState.calls).toBe(1);
		expect(FakeTerminalWebSocket.instances).toHaveLength(1);
		expect(FakeTerminalWebSocket.instances[0]?.closes).toHaveLength(0);

		fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
		const settings = screen.getByRole("region", { name: "Settings" });
		const appearanceCard = within(settings)
			.getByRole("heading", { name: "Appearance" })
			.closest("section")!;
		await waitFor(() => expect(previewRendererState.calls).toBe(1));
		expect(
			within(appearanceCard)
				.getByTestId("terminal-typography-preview")
				.getAttribute("data-renderer"),
		).toBe("ghostty-web");
		expect(
			within(appearanceCard).getByTestId("terminal-typography-preview").querySelector("canvas"),
		).toBeTruthy();
		fireEvent.change(within(appearanceCard).getByLabelText("Line height adjustment"), {
			target: { value: "3.5" },
		});
		const fontSizes = within(appearanceCard).getAllByLabelText("Font size");
		fireEvent.change(fontSizes[1]!, {
			target: { value: "16" },
		});
		fireEvent.change(fontSizes[1]!, {
			target: { value: "17" },
		});
		fireEvent.change(fontSizes[1]!, {
			target: { value: "18" },
		});
		await waitFor(() => expect(rendererState.calls).toBe(1));
		expect(FakeTerminalWebSocket.instances[0]?.closes).toHaveLength(0);
		const save = within(settings).getByRole("button", {
			name: "Save changes",
		}) as HTMLButtonElement;
		expect(save.disabled).toBe(false);

		fireEvent.click(save);
		await waitFor(() => expect(rendererState.calls).toBe(2));
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(2));
		await waitFor(() => expect(save.disabled).toBe(true));

		fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
		fireEvent.click(screen.getByRole("button", { name: "Open tmux terminal" }));
		expect(rendererState.calls).toBe(2);
		expect(screen.getByRole("region", { name: "tmux terminal" }).getAttribute("aria-hidden")).toBe(
			"false",
		);
	});

	test("opens Settings directly from its own route", async () => {
		window.history.replaceState(null, "", "/settings?repo=repo");
		render(<App />);

		const settings = await screen.findByRole("region", { name: "Settings" });
		expect(window.location.pathname).toBe("/settings");
		expect(within(settings).getByRole("heading", { name: "Profiles" })).toBeTruthy();
		expect(within(settings).getByRole("heading", { name: "Appearance" })).toBeTruthy();
		expect(screen.queryByRole("region", { name: "Unified diff" })).toBeNull();

		fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
		await screen.findByText("src/first.ts");
		expect(window.location.pathname).toBe("/");
	});

	test("persists one Codex model and reasoning choice for commit and artifact generation", async () => {
		window.history.replaceState(null, "", "/settings?repo=repo");
		render(<App />);

		const settings = await screen.findByRole("region", { name: "Settings" });
		const codexCard = within(settings)
			.getByRole("heading", { name: "Codex generation" })
			.closest("section")!;
		fireEvent.change(within(codexCard).getByLabelText("Model"), {
			target: { value: "gpt-5.6-terra" },
		});
		fireEvent.change(within(codexCard).getByLabelText("Reasoning effort"), {
			target: { value: "medium" },
		});
		fireEvent.click(within(settings).getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(fixture.settingsProfiles[0]?.data.codex).toEqual({
				model: "gpt-5.6-terra",
				reasoning: "medium",
			}),
		);
	});

	test("defaults a legacy settings profile without entering a bootstrap update loop", async () => {
		delete (fixture.settingsProfiles[0]!.data as { codex?: unknown }).codex;
		window.history.replaceState(null, "", "/settings?repo=repo");
		render(<App />);

		const settings = await screen.findByRole("region", { name: "Settings" });
		expect((within(settings).getByLabelText("Model") as HTMLInputElement).value).toBe(
			"gpt-5.6-luna",
		);
	});

	test("opens the global command palette, filters commands, and executes a destination", async () => {
		render(<App />);
		await screen.findByText("src/first.ts");

		fireEvent.keyDown(window, { key: "k", ctrlKey: true });
		const palette = await screen.findByRole("dialog", {
			name: "Couchview command palette",
		});
		expect(within(palette).queryByText("Open command palette")).toBeNull();
		expect(within(palette).getByText("Go to terminal")).toBeTruthy();
		expect(within(palette).getByText("tmux is unavailable in this test.")).toBeTruthy();
		expect(
			within(palette)
				.getByText("Go to terminal")
				.closest("[cmdk-item]")
				?.getAttribute("aria-disabled"),
		).toBe("true");

		fireEvent.change(
			within(palette).getByRole("combobox", {
				name: "Couchview command palette",
			}),
			{
				target: { value: "settings" },
			},
		);
		expect(within(palette).getByText("Go to settings")).toBeTruthy();
		fireEvent.click(within(palette).getByText("Go to settings"));

		expect(await screen.findByRole("region", { name: "Settings" })).toBeTruthy();
		expect(window.location.pathname).toBe("/settings");
		expect(screen.queryByRole("dialog", { name: "Couchview command palette" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
		expect(
			await screen.findByRole("dialog", {
				name: "Couchview command palette",
			}),
		).toBeTruthy();
	});

	test("executes multi-stroke shortcuts and shifts only navigation defaults for Dvorak", async () => {
		fixture.terminalAvailable = true;
		render(<App />);
		await screen.findByText("src/first.ts");

		fireEvent.keyDown(window, { key: "g" });
		expect(document.querySelector(".shortcut-pending-hud")?.textContent).toBe("G");
		fireEvent.keyDown(window, { key: "t" });
		expect(await screen.findByRole("region", { name: "tmux terminal" })).toBeTruthy();
		expect(document.querySelector(".shortcut-pending-hud")).toBeNull();

		cleanup();
		fixture.settingsProfiles[0]!.data.keyboard.layout = "dvorak";
		render(<App />);
		await screen.findByText("src/first.ts");
		fireEvent.keyDown(window, { key: "l" });
		expect(screen.getByText("src/first.ts")).toBeTruthy();
		fireEvent.keyDown(window, { key: "s" });
		expect(await screen.findByText("src/second.ts")).toBeTruthy();
		fireEvent.keyDown(window, { key: "g" });
		fireEvent.keyDown(window, { key: "s" });
		expect(await screen.findByRole("region", { name: "Settings" })).toBeTruthy();
	});

	test("creates, renames, duplicates, selects, and deletes host-wide profiles", async () => {
		const prompts = ["Team", "Team copy"];
		Object.defineProperty(window, "prompt", {
			configurable: true,
			value: () => prompts.shift() ?? null,
		});
		window.history.replaceState(null, "", "/settings");
		render(<App />);
		const settings = await screen.findByRole("region", { name: "Settings" });
		const selector = within(settings).getByLabelText("Active profile") as HTMLSelectElement;
		expect(selector.value).toBe(DEFAULT_SETTINGS_PROFILE_ID);
		expect(
			(
				within(settings).getByRole("button", {
					name: /Delete/,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);

		fireEvent.click(within(settings).getByRole("button", { name: /New/ }));
		await waitFor(() => expect(fixture.settingsProfiles).toHaveLength(2));
		expect(selector.value).toBe("profile-1");
		expect(localStorage.getItem("couchview:settings-profile-id:v1")).toBe("profile-1");

		const name = within(settings).getByLabelText("Profile name");
		expect((name as HTMLInputElement).disabled).toBe(false);
		await waitFor(() =>
			expect(
				(
					within(settings).getByRole("button", {
						name: "Save changes",
					}) as HTMLButtonElement
				).disabled,
			).toBe(true),
		);
		fireEvent.input(name, { target: { value: "Team renamed" } });
		await waitFor(() => expect((name as HTMLInputElement).value).toBe("Team renamed"));
		const save = within(settings).getByRole("button", {
			name: "Save changes",
		}) as HTMLButtonElement;
		expect(save.disabled).toBe(false);
		fireEvent.click(save);
		await waitFor(() =>
			expect(
				fixture.requests.some(
					(entry) => entry.path === "/api/settings/profiles/profile-1" && entry.method === "PUT",
				),
			).toBe(true),
		);
		expect(
			fixture.requests.find(
				(entry) => entry.path === "/api/settings/profiles/profile-1" && entry.method === "PUT",
			)?.body,
		).toMatchObject({ name: "Team renamed" });
		await waitFor(() => expect(fixture.settingsProfiles[1]?.name).toBe("Team renamed"));

		fireEvent.click(within(settings).getByRole("button", { name: /Duplicate/ }));
		await waitFor(() => expect(fixture.settingsProfiles).toHaveLength(3));
		expect(selector.value).toBe("profile-2");
		expect(fixture.settingsProfiles[2]).toMatchObject({
			name: "Team copy",
			data: fixture.settingsProfiles[1]!.data,
		});

		fireEvent.click(within(settings).getByRole("button", { name: /Delete/ }));
		await waitFor(() => expect(fixture.settingsProfiles).toHaveLength(2));
		expect(selector.value).toBe(DEFAULT_SETTINGS_PROFILE_ID);
		expect(localStorage.getItem("couchview:settings-profile-id:v1")).toBe(
			DEFAULT_SETTINGS_PROFILE_ID,
		);
	});

	test("preserves a dirty draft across a stale save and warns before leaving Settings", async () => {
		const customData = createDefaultSettingsProfileData();
		fixture.settingsProfiles.push({
			id: "custom",
			name: "Custom",
			data: customData,
			revision: 1,
			createdAt: "2026-07-31T00:03:00.000Z",
			updatedAt: "2026-07-31T00:03:00.000Z",
		});
		localStorage.setItem("couchview:settings-profile-id:v1", "custom");
		let allowDiscard = false;
		const alerts: string[] = [];
		Object.defineProperty(window, "confirm", {
			configurable: true,
			value: () => allowDiscard,
		});
		Object.defineProperty(window, "alert", {
			configurable: true,
			value: (message: string) => alerts.push(message),
		});
		window.history.replaceState(null, "", "/settings");
		render(<App />);
		const settings = await screen.findByRole("region", { name: "Settings" });
		const appearance = within(settings)
			.getByRole("heading", { name: "Appearance" })
			.closest("section")!;
		const diffFontSize = within(appearance).getAllByLabelText("Font size")[0] as HTMLInputElement;
		fireEvent.change(diffFontSize, { target: { value: "14" } });
		fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
		expect(window.location.pathname).toBe("/settings");
		expect(screen.getByRole("region", { name: "Settings" })).toBeTruthy();

		fixture.staleNextSettingsSave = true;
		fireEvent.click(within(settings).getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(alerts).toContain("The settings profile changed on another client."),
		);
		expect(diffFontSize.value).toBe("14");
		expect(
			(
				within(settings).getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);

		fireEvent.click(within(settings).getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(fixture.settingsProfiles.find((profile) => profile.id === "custom")).toMatchObject({
				revision: 3,
				data: { typography: { diff: { fontSize: 14 } } },
			}),
		);
		allowDiscard = true;
		fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
		expect(window.location.pathname).toBe("/");
	});

	test("records a shortcut and atomically replaces its exact conflict", async () => {
		window.history.replaceState(null, "", "/settings");
		render(<App />);
		const settings = await screen.findByRole("region", { name: "Settings" });
		const keyboardCard = within(settings)
			.getByRole("heading", { name: "Keyboard shortcuts" })
			.closest("section")!;
		const previousFileRow = within(keyboardCard)
			.getByText("Previous file")
			.closest(".keybinding-row") as HTMLElement;
		const nextFileRow = within(keyboardCard)
			.getByText("Next file")
			.closest(".keybinding-row") as HTMLElement;
		expect(previousFileRow.querySelector("kbd")?.textContent).toBe("H");
		expect(nextFileRow.querySelector("kbd")?.textContent).toBe("L");

		fireEvent.click(within(previousFileRow).getByRole("button", { name: "Record" }));
		fireEvent.keyDown(window, { key: "l" });
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1_050));
		});
		expect(previousFileRow.querySelector("kbd")?.textContent).toBe("L");
		expect(nextFileRow.querySelector("kbd")?.textContent).toBe("Unassigned");

		fireEvent.click(within(settings).getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(fixture.settingsProfiles[0]?.data.keyboard.bindings).toMatchObject({
				"file.previous": [{ key: "l", modifiers: [] }],
				"file.next": null,
			}),
		);
		fireEvent.click(
			within(previousFileRow).getByRole("button", {
				name: "Reset Previous file shortcut",
			}),
		);
		expect(previousFileRow.querySelector("kbd")?.textContent).toBe("H");
		fireEvent.click(
			within(nextFileRow).getByRole("button", {
				name: "Reset Next file shortcut",
			}),
		);
		expect(nextFileRow.querySelector("kbd")?.textContent).toBe("L");
	});

	test("persists independent diff and terminal typography from Settings", async () => {
		fixture.terminalAvailable = true;
		render(<App />);
		await screen.findByText("src/first.ts");

		fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
		const settings = screen.getByRole("region", { name: "Settings" });
		expect(window.location.pathname).toBe("/settings");
		const appearanceCard = within(settings)
			.getByRole("heading", { name: "Appearance" })
			.closest("section")!;
		expect(within(appearanceCard).getByTestId("diff-column-ruler").textContent).toContain("80");
		expect(within(appearanceCard).getByTestId("terminal-column-ruler").textContent).toContain("80");
		expect(within(appearanceCard).getByLabelText("lualine preview").textContent).toContain(
			"NORMAL",
		);
		expect(within(appearanceCard).getByLabelText("lualine preview").textContent).toContain("");
		expect(within(appearanceCard).getByLabelText("tmux status preview").textContent).toContain(
			"nvim *",
		);
		expect(within(appearanceCard).getByLabelText("Cell width adjustment").getAttribute("min")).toBe(
			"-5",
		);
		expect(within(appearanceCard).getByLabelText("Cell width adjustment").getAttribute("max")).toBe(
			"5",
		);

		const systemFonts = within(appearanceCard).getAllByRole("button", {
			name: /^System monospace/,
		});
		fireEvent.click(systemFonts[0]!);
		const fontSizes = within(appearanceCard).getAllByLabelText("Font size");
		fireEvent.change(fontSizes[0]!, {
			target: { value: "14" },
		});
		fireEvent.change(within(appearanceCard).getByLabelText("Line height adjustment"), {
			target: { value: "3.5" },
		});
		fireEvent.change(within(appearanceCard).getByLabelText("Width adjustment"), {
			target: { value: "0.4" },
		});

		fireEvent.click(systemFonts[1]!);
		fireEvent.change(fontSizes[1]!, {
			target: { value: "18" },
		});
		fireEvent.change(within(appearanceCard).getByLabelText("Cell height adjustment"), {
			target: { value: "4" },
		});
		fireEvent.change(within(appearanceCard).getByLabelText("Cell width adjustment"), {
			target: { value: "-5" },
		});

		expect(
			within(appearanceCard).getByTestId("diff-typography-preview").style.fontFamily,
		).toStartWith("ui-monospace");
		await waitFor(() =>
			expect(previewRendererState.configs.at(-1)).toMatchObject({
				fontFamily: "system",
				fontSize: 18,
				cellHeightAdjustment: 4,
				cellWidthAdjustment: -5,
			}),
		);
		expect(localStorage.getItem("couchview:typography:v1")).toBeNull();
		const save = within(settings).getByRole("button", {
			name: "Save changes",
		}) as HTMLButtonElement;
		expect(save.disabled).toBe(false);
		fireEvent.click(save);
		await waitFor(() => expect(save.disabled).toBe(true));
		expect(fixture.settingsProfiles[0]!.data.typography.diff).toEqual({
			fontFamily: "system",
			fontSize: 14,
			lineHeightAdjustment: 3.5,
			widthAdjustment: 0.4,
		});
		expect(fixture.settingsProfiles[0]!.data.typography.terminal).toEqual({
			fontFamily: "system",
			fontSize: 18,
			cellHeightAdjustment: 4,
			cellWidthAdjustment: -5,
		});

		fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
		expect(window.location.pathname).toBe("/");
		const viewer = screen.getByTestId("pierre-code-view");
		expect(viewer.style.fontFamily).toStartWith("ui-monospace");
		expect(viewer.style.fontSize).toBe("14px");
		expect(viewer.style.lineHeight).toBe("25.2px");
		expect(viewer.style.letterSpacing).toBe("0.4px");

		fireEvent.click(screen.getByRole("button", { name: "Open tmux terminal" }));
		await waitFor(() => expect(rendererState.calls).toBe(1));
		expect(rendererState.options?.config).toMatchObject(
			fixture.settingsProfiles[0]!.data.typography.terminal,
		);
	});
});
