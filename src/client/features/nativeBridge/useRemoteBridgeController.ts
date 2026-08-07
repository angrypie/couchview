import * as Linking from "expo-linking";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
	CreateRemoteBridgePairingRequest,
	RemoteBridgeCapability,
	RemoteBridgeDevice,
	RemoteBridgeDevicesResponse,
	RemoteBridgePairingResponse,
} from "../../../shared/contracts.ts";
import {
	remoteBridgeClaudeCommand,
	remoteBridgeCodexCommand,
	remoteBridgeTerminalCommand,
	remoteBridgeZedCommand,
	remoteBridgeZedUrl,
} from "../../../shared/remoteBridgeCommands.ts";
import { api } from "../../api.ts";
import { copyToClipboard } from "../../lib/clipboard.ts";
import { confirmAction } from "../../lib/confirmAction";

const POLL_INTERVAL_MS = 2_000;

export interface RemoteBridgeLaunchCommand {
	command: string;
	copyLabel: string;
	copyNotice: string;
	id: "zed" | "codex" | "terminal" | "claude";
	openLabel?: string;
	openUrl?: string;
	title: string;
}

export interface RemoteBridgeDeviceItem {
	commands: RemoteBridgeLaunchCommand[];
	id: string;
	label: string;
	lastUsedLabel: string;
	raw: RemoteBridgeDevice;
}

type RemoteBridgeApi = {
	createRemoteBridgePairing(
		repositoryId: string,
		body: CreateRemoteBridgePairingRequest,
		csrfToken: string,
		signal?: AbortSignal,
	): Promise<RemoteBridgePairingResponse>;
	remoteBridgeDevices(
		repositoryId: string,
		signal?: AbortSignal,
	): Promise<RemoteBridgeDevicesResponse>;
	revokeRemoteBridgeDevice(
		repositoryId: string,
		deviceId: string,
		csrfToken: string,
		signal?: AbortSignal,
	): Promise<void>;
};

export interface RemoteBridgeControllerDependencies extends RemoteBridgeApi {
	confirm(message: string, title?: string): Promise<boolean>;
	copyText(text: string): Promise<void>;
	now(): number;
	openUrl(url: string): Promise<unknown>;
	schedulePolling(callback: () => void, intervalMs: number): () => void;
}

const defaultDependencies: RemoteBridgeControllerDependencies = {
	createRemoteBridgePairing: (...args) => api.createRemoteBridgePairing(...args),
	remoteBridgeDevices: (...args) => api.remoteBridgeDevices(...args),
	revokeRemoteBridgeDevice: (...args) => api.revokeRemoteBridgeDevice(...args),
	confirm: confirmAction,
	copyText: copyToClipboard,
	now: Date.now,
	openUrl: Linking.openURL,
	schedulePolling(callback, intervalMs) {
		const intervalId = globalThis.setInterval(callback, intervalMs);
		return () => globalThis.clearInterval(intervalId);
	},
};

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : "The native bridge request failed.";
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function enableCommand(repositoryRoot: string): string {
	return `couchview serve ${shellQuote(repositoryRoot)} --enable-remote-bridge --enable-remote-bridge-p2p`;
}

function formatDeviceTime(value: string | null): string {
	if (!value) return "Never connected";
	return `Last used ${new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value))}`;
}

function deviceItem(device: RemoteBridgeDevice, repositoryRoot: string): RemoteBridgeDeviceItem {
	return {
		commands: [
			{
				command: remoteBridgeZedCommand(device.sshAlias, repositoryRoot),
				copyLabel: `Copy Zed command for ${device.label}`,
				copyNotice: "Zed command copied",
				id: "zed",
				openLabel: `Open ${repositoryRoot} in Zed through ${device.label}`,
				openUrl: remoteBridgeZedUrl(device.sshAlias, repositoryRoot),
				title: "Zed",
			},
			{
				command: remoteBridgeCodexCommand(device.sshAlias, repositoryRoot),
				copyLabel: `Copy Codex command for ${device.label}`,
				copyNotice: "Codex command copied",
				id: "codex",
				title: "Codex",
			},
			{
				command: remoteBridgeTerminalCommand(device.sshAlias, repositoryRoot),
				copyLabel: `Copy terminal command for ${device.label}`,
				copyNotice: "Terminal command copied",
				id: "terminal",
				title: "Terminal",
			},
			{
				command: remoteBridgeClaudeCommand(device.sshAlias, repositoryRoot),
				copyLabel: `Copy Claude Code Remote Control command for ${device.label}`,
				copyNotice: "Claude Code Remote Control command copied",
				id: "claude",
				title: "Claude Code Remote Control",
			},
		],
		id: device.id,
		label: device.label,
		lastUsedLabel: formatDeviceTime(device.lastUsedAt),
		raw: device,
	};
}

export interface UseRemoteBridgeControllerOptions {
	active: boolean;
	capability: RemoteBridgeCapability;
	csrfToken: string;
	onNotice(message: string): void;
	repositoryId: string;
	repositoryRoot: string;
}

export function useRemoteBridgeController(
	{
		active,
		capability,
		csrfToken,
		onNotice,
		repositoryId,
		repositoryRoot,
	}: UseRemoteBridgeControllerOptions,
	dependencies: RemoteBridgeControllerDependencies = defaultDependencies,
) {
	const [devices, setDevices] = useState<RemoteBridgeDevice[]>([]);
	const [loading, setLoading] = useState(false);
	const [creating, setCreating] = useState(false);
	const [revokingId, setRevokingId] = useState<string | null>(null);
	const [label, setLabel] = useState("My Mac");
	const [pairing, setPairing] = useState<RemoteBridgePairingResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(
		async (signal?: AbortSignal) => {
			if (!capability.available) {
				setLoading(false);
				return;
			}
			setLoading(true);
			try {
				const response = await dependencies.remoteBridgeDevices(repositoryId, signal);
				setDevices(response.devices);
				setError(null);
				setPairing((current) =>
					current && response.devices.some((device) => device.sshAlias === current.sshAlias)
						? null
						: current,
				);
			} catch (nextError) {
				if (!signal?.aborted) setError(messageOf(nextError));
			} finally {
				if (!signal?.aborted) setLoading(false);
			}
		},
		[capability.available, dependencies, repositoryId],
	);

	useEffect(() => {
		if (!active) return;
		const controller = new AbortController();
		void refresh(controller.signal);
		return () => controller.abort();
	}, [active, refresh]);

	useEffect(() => {
		if (!active || !pairing) return;
		const expiresAt = new Date(pairing.expiresAt).getTime();
		return dependencies.schedulePolling(() => {
			if (dependencies.now() >= expiresAt) {
				setPairing(null);
				setError("That pairing command expired. Generate a new one to continue.");
				return;
			}
			void refresh();
		}, POLL_INTERVAL_MS);
	}, [active, dependencies, pairing, refresh]);

	const createPairing = useCallback(async () => {
		const nextLabel = label.trim();
		if (!nextLabel || creating) return;
		setCreating(true);
		setError(null);
		try {
			const response = await dependencies.createRemoteBridgePairing(
				repositoryId,
				{ label: nextLabel },
				csrfToken,
			);
			setPairing(response);
			onNotice("Pairing command created");
		} catch (nextError) {
			setError(messageOf(nextError));
		} finally {
			setCreating(false);
		}
	}, [creating, csrfToken, dependencies, label, onNotice, repositoryId]);

	const revoke = useCallback(
		async (device: RemoteBridgeDevice) => {
			if (revokingId) return;
			try {
				if (!(await dependencies.confirm(`Revoke native IDE access for ${device.label}?`))) return;
				setRevokingId(device.id);
				setError(null);
				await dependencies.revokeRemoteBridgeDevice(repositoryId, device.id, csrfToken);
				setDevices((current) => current.filter((candidate) => candidate.id !== device.id));
				onNotice(`Revoked ${device.label}`);
			} catch (nextError) {
				setError(messageOf(nextError));
			} finally {
				setRevokingId(null);
			}
		},
		[csrfToken, dependencies, onNotice, repositoryId, revokingId],
	);

	const copyCommand = useCallback(
		async (command: string, notice: string) => {
			setError(null);
			try {
				await dependencies.copyText(command);
				onNotice(notice);
			} catch (nextError) {
				setError(messageOf(nextError));
			}
		},
		[dependencies, onNotice],
	);

	const openUrl = useCallback(
		async (url: string) => {
			setError(null);
			try {
				await dependencies.openUrl(url);
			} catch (nextError) {
				setError(messageOf(nextError));
			}
		},
		[dependencies],
	);

	return {
		available: capability.available,
		capability,
		copyCommand,
		createPairing,
		creating,
		deviceItems: useMemo(
			() => devices.map((device) => deviceItem(device, repositoryRoot)),
			[devices, repositoryRoot],
		),
		enableCommand: useMemo(() => enableCommand(repositoryRoot), [repositoryRoot]),
		error,
		label,
		loading,
		openUrl,
		pairing,
		refresh,
		revoke,
		revokingId,
		setLabel,
	};
}

export type RemoteBridgeController = ReturnType<typeof useRemoteBridgeController>;
