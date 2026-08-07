import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { RemoteBridgeDevice } from "../../../shared/contracts.ts";
import type { RemoteBridgeControllerDependencies } from "./useRemoteBridgeController.ts";

mock.module("expo-linking", () => ({ openURL: async () => undefined }));
mock.module("expo-clipboard", () => ({ setStringAsync: async () => undefined }));

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { useRemoteBridgeController } = await import("./useRemoteBridgeController.ts");

type RemoteBridgeController = ReturnType<typeof useRemoteBridgeController>;

const DEVICE: RemoteBridgeDevice = {
	createdAt: "2026-08-07T00:00:00.000Z",
	id: "device-one",
	label: "MacBook Air",
	lastUsedAt: "2026-08-07T09:30:00.000Z",
	repositoryId: "repository-one",
	sshAlias: "couchview-device-one",
};

interface DependencyFixture {
	confirmResult: boolean;
	copied: string[];
	createdLabels: string[];
	dependencies: RemoteBridgeControllerDependencies;
	devices: RemoteBridgeDevice[];
	now: number;
	opened: string[];
	pollers: Set<() => void>;
	revoked: string[];
}

function createDependencies(): DependencyFixture {
	const fixture: DependencyFixture = {
		confirmResult: true,
		copied: [],
		createdLabels: [],
		dependencies: null as unknown as RemoteBridgeControllerDependencies,
		devices: [DEVICE],
		now: Date.parse("2026-08-07T10:00:00.000Z"),
		opened: [],
		pollers: new Set<() => void>(),
		revoked: [],
	};
	fixture.dependencies = {
		confirm: async () => fixture.confirmResult,
		copyText: async (text) => {
			fixture.copied.push(text);
		},
		createRemoteBridgePairing: async (_repositoryId, body) => {
			fixture.createdLabels.push(body.label);
			return {
				command: `couchview bridge pair ${body.label}`,
				expiresAt: new Date(fixture.now + 60_000).toISOString(),
				sshAlias: "pending-alias",
			};
		},
		now: () => fixture.now,
		openUrl: async (url) => {
			fixture.opened.push(url);
		},
		remoteBridgeDevices: async () => ({ devices: fixture.devices }),
		revokeRemoteBridgeDevice: async (_repositoryId, deviceId) => {
			fixture.revoked.push(deviceId);
		},
		schedulePolling: (callback) => {
			fixture.pollers.add(callback);
			return () => fixture.pollers.delete(callback);
		},
	};
	return fixture;
}

let controller: RemoteBridgeController | null = null;

function ControllerHarness({
	dependencies,
	onNotice,
}: {
	dependencies: RemoteBridgeControllerDependencies;
	onNotice(message: string): void;
}) {
	controller = useRemoteBridgeController(
		{
			active: true,
			capability: { available: true, p2pEnabled: true, reason: null },
			csrfToken: "csrf-token",
			onNotice,
			repositoryId: "repository-one",
			repositoryRoot: "/Users/mini/Project One",
		},
		dependencies,
	);
	return (
		<output data-testid="bridge-state">
			{controller.deviceItems.length}:{controller.pairing?.command ?? "none"}:
			{controller.error ?? "ok"}
		</output>
	);
}

function currentController(): RemoteBridgeController {
	if (!controller) throw new Error("The controller harness has not rendered.");
	return controller;
}

afterEach(() => {
	cleanup();
	controller = null;
});

describe("remote bridge controller", () => {
	test("loads commands and owns copy, open, confirmation, and revoke side effects", async () => {
		const fixture = createDependencies();
		const notices: string[] = [];
		render(
			<ControllerHarness
				dependencies={fixture.dependencies}
				onNotice={(notice) => notices.push(notice)}
			/>,
		);
		await waitFor(() => expect(currentController().deviceItems).toHaveLength(1));
		const item = currentController().deviceItems[0]!;
		const zed = item.commands[0]!;
		expect(zed.command).toBe("zed 'ssh://couchview-device-one/Users/mini/Project%20One'");

		await act(async () => currentController().copyCommand(zed.command, zed.copyNotice));
		await act(async () => currentController().openUrl(zed.openUrl!));
		expect(fixture.copied).toEqual([zed.command]);
		expect(fixture.opened).toEqual([zed.openUrl!]);
		expect(notices).toContain("Zed command copied");

		await act(async () => currentController().revoke(item.raw));
		expect(fixture.revoked).toEqual([DEVICE.id]);
		expect(currentController().deviceItems).toHaveLength(0);
		expect(notices).toContain("Revoked MacBook Air");
	});

	test("polls pairing to completion and reports command expiry", async () => {
		const fixture = createDependencies();
		fixture.devices = [];
		const notices: string[] = [];
		render(
			<ControllerHarness
				dependencies={fixture.dependencies}
				onNotice={(notice) => notices.push(notice)}
			/>,
		);
		await waitFor(() => expect(screen.getByTestId("bridge-state").textContent).toBe("0:none:ok"));

		act(() => currentController().setLabel("  Travel Air  "));
		await act(async () => currentController().createPairing());
		expect(fixture.createdLabels).toEqual(["Travel Air"]);
		expect(notices).toContain("Pairing command created");
		await waitFor(() => expect(fixture.pollers.size).toBe(1));

		fixture.devices = [{ ...DEVICE, sshAlias: "pending-alias" }];
		await act(async () => {
			fixture.pollers.values().next().value?.();
			await Promise.resolve();
		});
		await waitFor(() => expect(currentController().pairing).toBeNull());

		fixture.devices = [];
		await act(async () => currentController().createPairing());
		await waitFor(() => expect(fixture.pollers.size).toBe(1));
		fixture.now += 61_000;
		act(() => fixture.pollers.values().next().value?.());
		expect(currentController().pairing).toBeNull();
		expect(currentController().error).toBe(
			"That pairing command expired. Generate a new one to continue.",
		);
	});

	test("surfaces API and platform-action failures in controller state", async () => {
		const fixture = createDependencies();
		fixture.dependencies.remoteBridgeDevices = async () => {
			throw new Error("Bridge host is offline");
		};
		render(<ControllerHarness dependencies={fixture.dependencies} onNotice={() => undefined} />);
		await waitFor(() => expect(currentController().error).toBe("Bridge host is offline"));

		fixture.dependencies.copyText = async () => {
			throw new Error("Clipboard is unavailable");
		};
		await act(async () => currentController().copyCommand("command", "Copied"));
		expect(currentController().error).toBe("Clipboard is unavailable");
	});
});
