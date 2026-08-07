import { describe, expect, test } from "bun:test";
import { useState } from "react";
import type { AppRouteConfiguration } from "./App.tsx";
import {
	App,
	act,
	cleanup,
	createAppTestHarness,
	createDefaultSettingsProfileData,
	FakeTerminalWebSocket,
	fireEvent,
	nativeTestRuntime,
	previewRendererState,
	render,
	rendererState,
	screen,
	waitFor,
	within,
} from "./appTestHarness.tsx";

type WorkspaceMode = NonNullable<AppRouteConfiguration["initialMode"]>;
type ControlledRouteAppProps = Omit<AppRouteConfiguration, "initialMode" | "onNavigate"> & {
	initialMode?: WorkspaceMode;
	onRouteChange?(mode: WorkspaceMode, replace: boolean): void;
};

function ControlledRouteApp({
	initialMode = "review",
	onRouteChange,
	...props
}: ControlledRouteAppProps) {
	const [mode, setMode] = useState(initialMode);
	return (
		<App
			{...props}
			initialMode={mode}
			onNavigate={(nextMode, replace = false) => {
				onRouteChange?.(nextMode, replace);
				setMode(nextMode);
			}}
		/>
	);
}

describe("Couchview app lifecycle and settings", () => {
	const fixture = createAppTestHarness();
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
		render(<App requestedRepositoryId="repo-two" />);

		await screen.findByRole("heading", { name: "Sign-in expired" });
		expect(screen.getByText("Sign in again to continue using Couchview.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
		expect(nativeTestRuntime.openedUrls).toEqual([
			"http://127.0.0.1:4173/api/access/refresh?repo=repo-two",
		]);
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Reset app cache" })).toBeNull();
	});

	test("stops a completed Access sign-in from silently looping", async () => {
		fixture.bootstrapFailureStatus = 401;
		let handledRefreshes = 0;
		let rearmAccessRefresh = () => {};
		function AccessRefreshRoute() {
			const [accessRefreshAttempted, setAccessRefreshAttempted] = useState(true);
			rearmAccessRefresh = () => setAccessRefreshAttempted(true);
			return (
				<App
					accessRefreshAttempted={accessRefreshAttempted}
					onAccessRefreshHandled={() => {
						handledRefreshes += 1;
						setAccessRefreshAttempted(false);
					}}
					requestedRepositoryId="repo-two"
				/>
			);
		}
		render(<AccessRefreshRoute />);

		await screen.findByRole("heading", { name: "Sign-in didn’t complete" });
		expect(
			screen.getByText(
				"Cloudflare returned to Couchview, but this device still does not have a usable Access session.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Reset Cloudflare sign-in" }));
		fireEvent.click(screen.getByRole("button", { name: "Try sign-in again" }));
		expect(nativeTestRuntime.openedUrls).toEqual([
			"http://127.0.0.1:4173/api/access/logout",
			"http://127.0.0.1:4173/api/access/refresh?repo=repo-two",
		]);
		expect(handledRefreshes).toBe(1);
		expect(fixture.requests.filter((request) => request.path === "/api/bootstrap")).toHaveLength(1);

		await act(async () => rearmAccessRefresh());
		await waitFor(() => expect(handledRefreshes).toBe(2));
		expect(screen.getByRole("heading", { name: "Sign-in didn’t complete" })).toBeTruthy();
		expect(fixture.requests.filter((request) => request.path === "/api/bootstrap")).toHaveLength(2);
	});

	test("offers sign-in, retry, and app-cache recovery for a connection failure", async () => {
		globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
		render(<App />);

		await screen.findByRole("heading", { name: "Couchview is unavailable" });
		expect(screen.getByText("Could not reach Couchview.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reset app cache" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
		expect(nativeTestRuntime.openedUrls).toEqual(["http://127.0.0.1:4173/api/access/refresh"]);
	});

	test("returns native-hosted failures to paired server management", async () => {
		let manageServersCalls = 0;
		globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
		render(
			<App
				nativeServerManagerUrl="couchview://servers"
				onManageServers={() => {
					manageServersCalls += 1;
				}}
			/>,
		);

		await screen.findByRole("heading", { name: "Couchview is unavailable" });
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Manage servers" }));
		expect(manageServersCalls).toBe(1);
		expect(screen.queryByRole("button", { name: "Reset app cache" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Sign in again" })).toBeNull();
	});

	test("does not suggest authentication or cache recovery for a server response", async () => {
		fixture.bootstrapFailureStatus = 503;
		render(<App />);

		await screen.findByRole("heading", { name: "Couldn’t open Couchview" });
		expect(screen.getByText("Request failed (503)")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Reset app cache" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Sign in again" })).toBeNull();
	});

	test("keeps one terminal connection across a bootstrap-only settings refresh", async () => {
		fixture.terminalAvailable = true;
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Open tmux terminal" }));
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const socket = FakeTerminalWebSocket.instances[0]!;

		fireEvent.click(screen.getByRole("button", { name: "Review" }));
		fireEvent.click(screen.getByRole("button", { name: "Increase diff font size" }));
		await waitFor(() =>
			expect(fixture.settingsProfiles[0]?.data.typography.diff.fontSize).toBe(12),
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(FakeTerminalWebSocket.instances).toHaveLength(1);
		expect(socket.closes).toHaveLength(0);
		expect(
			fixture.requests.filter(
				(request) =>
					request.path === "/api/repositories/repo/terminal/attachments" &&
					request.method === "POST",
			),
		).toHaveLength(1);
	});

	test("preserves tmux across Review and applies terminal settings only once", async () => {
		fixture.terminalAvailable = true;
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Increase diff font size" }));
		await waitFor(() =>
			expect(fixture.settingsProfiles[0]?.data.typography.diff.fontSize).toBe(12),
		);
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
		expect(screen.getByRole("region", { name: "tmux terminal" }).getAttribute("aria-hidden")).toBe(
			"false",
		);

		fireEvent.click(screen.getByRole("button", { name: "Review" }));
		expect(screen.getByLabelText("tmux terminal").getAttribute("aria-hidden")).toBe("true");
		expect(screen.getByText("12px")).toBeTruthy();
		expect(rendererState.calls).toBe(1);
		expect(FakeTerminalWebSocket.instances).toHaveLength(1);
		expect(FakeTerminalWebSocket.instances[0]?.closes).toHaveLength(0);

		fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
		const settings = screen.getByRole("region", { name: "Settings" });
		const appearanceCard = within(settings)
			.getByRole("heading", { name: "Appearance" })
			.closest("section")!;
		await waitFor(() => expect(previewRendererState.calls).toBeGreaterThan(0));
		expect(
			within(appearanceCard)
				.getByTestId("terminal-typography-preview")
				.getAttribute("data-renderer"),
		).toBe("ghostty-web");
		expect(
			within(appearanceCard).getByTestId("terminal-typography-preview").querySelector("canvas"),
		).toBeTruthy();
		fireEvent.change(within(appearanceCard).getByLabelText("Terminal cell height adjustment"), {
			target: { value: "4" },
		});
		const terminalFontSize = within(appearanceCard).getByLabelText("Terminal font size");
		fireEvent.change(terminalFontSize, {
			target: { value: "16" },
		});
		fireEvent.change(terminalFontSize, {
			target: { value: "17" },
		});
		fireEvent.change(terminalFontSize, {
			target: { value: "18" },
		});
		expect(rendererState.calls).toBe(1);
		expect(FakeTerminalWebSocket.instances[0]?.closes).toHaveLength(0);
		const save = within(settings).getByRole("button", {
			name: "Save changes",
		}) as HTMLButtonElement;
		expect(save.disabled).toBe(false);

		fireEvent.click(save);
		await waitFor(() =>
			expect(fixture.settingsProfiles[0]?.data.typography.terminal.fontSize).toBe(18),
		);
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
		const routeChanges: Array<{ mode: WorkspaceMode; replace: boolean }> = [];
		render(
			<ControlledRouteApp
				initialMode="settings"
				onRouteChange={(mode, replace) => routeChanges.push({ mode, replace })}
				requestedRepositoryId="repo"
			/>,
		);

		const settings = await screen.findByRole("region", { name: "Settings" });
		expect(within(settings).getByRole("heading", { name: "Profiles" })).toBeTruthy();
		expect(within(settings).getByRole("heading", { name: "Appearance" })).toBeTruthy();
		expect(screen.queryByRole("region", { name: "Unified diff" })).toBeNull();

		fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
		await screen.findByText("src/first.ts");
		expect(routeChanges).toEqual([{ mode: "review", replace: true }]);
	});

	test("persists one Codex model and reasoning choice for commit and artifact generation", async () => {
		render(<App initialMode="settings" requestedRepositoryId="repo" />);

		const settings = await screen.findByRole("region", { name: "Settings" });
		const codexCard = within(settings)
			.getByRole("heading", { name: "Codex generation" })
			.closest("section")!;
		fireEvent.change(within(codexCard).getByLabelText("Model"), {
			target: { value: "gpt-5.6-terra" },
		});
		fireEvent.click(within(codexCard).getByRole("button", { name: "Reasoning effort" }));
		const reasoningPicker = await screen.findByRole("dialog", { name: "Reasoning effort" });
		fireEvent.click(within(reasoningPicker).getByRole("button", { name: "medium" }));
		fireEvent.click(within(settings).getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(fixture.settingsProfiles[0]?.data.codex).toEqual({
				model: "gpt-5.6-terra",
				reasoning: "medium",
			}),
		);
	});

	test("opens the global command palette, filters commands, and executes a destination", async () => {
		render(<App />);
		await screen.findByText("src/first.ts");

		fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
		const palette = await screen.findByRole("dialog", {
			name: "Command palette",
		});
		expect(within(palette).queryByText("Open command palette")).toBeNull();
		expect(within(palette).getByText("Go to terminal")).toBeTruthy();
		expect(within(palette).getByText("tmux is unavailable in this test.")).toBeTruthy();
		expect(
			within(palette)
				.getByRole("button", { name: /Go to terminal/ })
				.getAttribute("aria-disabled"),
		).toBe("true");

		fireEvent.change(within(palette).getByRole("textbox"), {
			target: { value: "settings" },
		});
		expect(within(palette).getByText("Go to settings")).toBeTruthy();
		fireEvent.click(within(palette).getByText("Go to settings"));

		expect(await screen.findByRole("region", { name: "Settings" })).toBeTruthy();
		expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /^Open command palette,/ }));
		expect(
			await screen.findByRole("dialog", {
				name: "Command palette",
			}),
		).toBeTruthy();
	});

	test("executes multi-stroke shortcuts and shifts only navigation defaults for Dvorak", async () => {
		fixture.terminalAvailable = true;
		render(<App />);
		await screen.findByText("src/first.ts");

		fireEvent.keyDown(window, { key: "g" });
		expect(screen.getByRole("alert").textContent).toBe("G");
		fireEvent.keyDown(window, { key: "t" });
		expect(await screen.findByRole("region", { name: "tmux terminal" })).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();

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

	test("applies a device-local theme without dirtying the active profile", async () => {
		render(<App initialMode="settings" />);

		const settings = await screen.findByRole("region", { name: "Settings" });
		const save = within(settings).getByRole("button", {
			name: "Save changes",
		}) as HTMLButtonElement;
		await waitFor(() => expect(save.disabled).toBe(true));
		expect(
			within(settings).getByRole("radio", { name: "System" }).getAttribute("aria-checked"),
		).toBe("true");

		const profilePutCount = fixture.requests.filter(
			(request) => request.method === "PUT" && request.path.startsWith("/api/settings/profiles/"),
		).length;
		fireEvent.click(within(settings).getByRole("radio", { name: "Light" }));

		await waitFor(() =>
			expect(
				within(settings).getByRole("radio", { name: "Light" }).getAttribute("aria-checked"),
			).toBe("true"),
		);
		expect(document.documentElement.classList.contains("light")).toBe(true);
		expect(save.disabled).toBe(true);
		expect(
			fixture.requests.filter(
				(request) => request.method === "PUT" && request.path.startsWith("/api/settings/profiles/"),
			).length,
		).toBe(profilePutCount);
	});

	test("creates, renames, duplicates, selects, and deletes host-wide profiles", async () => {
		render(<App initialMode="settings" />);
		const settings = await screen.findByRole("region", { name: "Settings" });
		const selector = within(settings).getByRole("button", { name: "Active profile" });
		expect(selector.textContent).toContain("Default");
		expect(
			(
				within(settings).getByRole("button", {
					name: /Delete/,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);

		fireEvent.click(within(settings).getByRole("button", { name: /New/ }));
		const createDialog = screen.getByRole("dialog", { name: "New profile" });
		fireEvent.change(within(createDialog).getByRole("textbox", { name: "Profile name" }), {
			target: { value: "Team" },
		});
		fireEvent.click(within(createDialog).getByRole("button", { name: "Create profile" }));
		await waitFor(() => expect(fixture.settingsProfiles).toHaveLength(2));
		await waitFor(() => expect(selector.textContent).toContain("Team"));

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
		const duplicateDialog = screen.getByRole("dialog", { name: "Duplicate profile" });
		fireEvent.change(within(duplicateDialog).getByRole("textbox", { name: "Profile name" }), {
			target: { value: "Team copy" },
		});
		fireEvent.click(within(duplicateDialog).getByRole("button", { name: "Duplicate" }));
		await waitFor(() => expect(fixture.settingsProfiles).toHaveLength(3));
		await waitFor(() => expect(selector.textContent).toContain("Team copy"));
		expect(fixture.settingsProfiles[2]).toMatchObject({
			name: "Team copy",
			data: fixture.settingsProfiles[1]!.data,
		});

		fireEvent.click(within(settings).getByRole("button", { name: /Delete/ }));
		const deleteDialog = screen.getByRole("dialog", { name: "Delete profile?" });
		fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete" }));
		await waitFor(() => expect(fixture.settingsProfiles).toHaveLength(2));
		await waitFor(() => expect(selector.textContent).toContain("Default"));
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
		const routeChanges: Array<{ mode: WorkspaceMode; replace: boolean }> = [];
		render(
			<ControlledRouteApp
				initialMode="settings"
				onRouteChange={(mode, replace) => routeChanges.push({ mode, replace })}
			/>,
		);
		const settings = await screen.findByRole("region", { name: "Settings" });
		fireEvent.click(within(settings).getByRole("button", { name: "Active profile" }));
		const profilePicker = await screen.findByRole("dialog", { name: "Active profile" });
		fireEvent.click(within(profilePicker).getByRole("button", { name: "Custom" }));
		await waitFor(() =>
			expect(
				(within(settings).getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value,
			).toBe("Custom"),
		);
		const appearance = within(settings)
			.getByRole("heading", { name: "Appearance" })
			.closest("section")!;
		const diffFontSize = within(appearance).getByLabelText("Diff font size") as HTMLInputElement;
		fireEvent.change(diffFontSize, { target: { value: "14" } });
		fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
		expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
		expect(routeChanges).toHaveLength(0);
		expect(screen.getByRole("region", { name: "Settings" })).toBeTruthy();
		fireEvent.click(
			within(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).getByRole("button", {
				name: "Cancel",
			}),
		);

		fixture.staleNextSettingsSave = true;
		fireEvent.click(within(settings).getByRole("button", { name: "Save changes" }));
		const staleDialog = await screen.findByRole("dialog", {
			name: "Settings could not be updated",
		});
		expect(
			within(staleDialog).getByText("The settings profile changed on another client."),
		).toBeTruthy();
		fireEvent.click(within(staleDialog).getByRole("button", { name: "OK" }));
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
		fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
		await waitFor(() => expect(routeChanges).toEqual([{ mode: "review", replace: true }]));
	});

	test("records a shortcut and atomically replaces its exact conflict", async () => {
		render(<App initialMode="settings" />);
		const settings = await screen.findByRole("region", { name: "Settings" });
		const keyboardCard = within(settings)
			.getByRole("heading", { name: "Keyboard shortcuts" })
			.closest("section")!;
		const previousFileRow = within(keyboardCard).getByTestId("keybinding-row-file.previous");
		const nextFileRow = within(keyboardCard).getByTestId("keybinding-row-file.next");
		expect(within(previousFileRow).getByText("H")).toBeTruthy();
		expect(within(nextFileRow).getByText("L")).toBeTruthy();

		fireEvent.click(within(previousFileRow).getByRole("button", { name: "Edit" }));
		const shortcutDialog = await screen.findByRole("dialog", { name: "Edit Previous file" });
		fireEvent.change(within(shortcutDialog).getByRole("textbox", { name: "Shortcut" }), {
			target: { value: "L" },
		});
		fireEvent.click(within(shortcutDialog).getByRole("button", { name: "Apply shortcut" }));
		const conflictDialog = screen.getByRole("dialog", {
			name: "Replace conflicting shortcuts?",
		});
		expect(within(conflictDialog).getByText(/This conflicts with Next file/)).toBeTruthy();
		fireEvent.click(within(conflictDialog).getByRole("button", { name: "Replace shortcuts" }));
		expect(within(previousFileRow).getByText("L")).toBeTruthy();
		expect(within(nextFileRow).getByText("Unassigned")).toBeTruthy();

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
		expect(within(previousFileRow).getByText("H")).toBeTruthy();
		fireEvent.click(
			within(nextFileRow).getByRole("button", {
				name: "Reset Next file shortcut",
			}),
		);
		expect(within(nextFileRow).getByText("L")).toBeTruthy();
	});

	test("persists independent diff and terminal typography from Settings", async () => {
		fixture.terminalAvailable = true;
		let settingsDirty = false;
		render(
			<App
				onSettingsDirtyChange={(dirty) => {
					settingsDirty = dirty;
				}}
			/>,
		);
		await screen.findByText("src/first.ts");

		fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
		const settings = screen.getByRole("region", { name: "Settings" });
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
		expect(
			within(appearanceCard).getByLabelText("Terminal cell width adjustment").getAttribute("min"),
		).toBe("-5");
		expect(
			within(appearanceCard).getByLabelText("Terminal cell width adjustment").getAttribute("max"),
		).toBe("5");

		const systemFonts = within(appearanceCard).getAllByRole("radio", {
			name: "System monospace",
		});
		fireEvent.click(systemFonts[0]!);
		fireEvent.change(within(appearanceCard).getByLabelText("Diff font size"), {
			target: { value: "14" },
		});
		fireEvent.change(within(appearanceCard).getByLabelText("Diff line height adjustment"), {
			target: { value: "3.5" },
		});
		fireEvent.change(within(appearanceCard).getByLabelText("Diff width adjustment"), {
			target: { value: "0.4" },
		});

		fireEvent.click(systemFonts[1]!);
		fireEvent.change(within(appearanceCard).getByLabelText("Terminal font size"), {
			target: { value: "18" },
		});
		fireEvent.change(within(appearanceCard).getByLabelText("Terminal cell height adjustment"), {
			target: { value: "4" },
		});
		fireEvent.change(within(appearanceCard).getByLabelText("Terminal cell width adjustment"), {
			target: { value: "-5" },
		});
		await waitFor(() => expect(settingsDirty).toBe(true));

		const diffPreview = within(appearanceCard).getByTestId("diff-typography-preview");
		expect(within(diffPreview).getByText(/const layout = browserSurface/).style.fontSize).toBe(
			"14px",
		);
		await waitFor(() =>
			expect(previewRendererState.configs.at(-1)).toMatchObject({
				fontFamily: "system",
				fontSize: 18,
				cellHeightAdjustment: 4,
				cellWidthAdjustment: -5,
			}),
		);
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
		await waitFor(() => expect(settingsDirty).toBe(false));

		fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
		await screen.findByRole("region", { name: "Unified diff" });
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
