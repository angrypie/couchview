import type {
	BootstrapResponse,
	CommitMessageCapability,
	RemoteBridgeCapability,
	SpeechCapability,
	TerminalCapability,
} from "../../../shared/contracts.ts";

export const unavailableCommitMessageCapability: CommitMessageCapability = {
	available: false,
	reason: "Commit message generation is unavailable from this Couchview server.",
};

export const unavailableTerminalCapability: TerminalCapability = {
	available: false,
	reason: "The browser tmux terminal is unavailable from this Couchview server.",
	persistence: "tmux",
	profiles: [],
};

export const unavailableRemoteBridgeCapability: RemoteBridgeCapability = {
	available: false,
	reason: "Native remote development is unavailable from this Couchview server.",
	p2pEnabled: false,
};

export const unavailableSpeechCapability: SpeechCapability = {
	enabled: false,
	ready: false,
	model: "parakeet-tdt-0.6b-v3-int8",
	maxDurationMs: 300_000,
	maxUploadBytes: 32 * 1024 * 1024,
	reason: "Host speech transcription is unavailable from this Couchview server.",
};

export function resolveHostCapabilities(bootstrap: BootstrapResponse | null) {
	return {
		commitMessageCapability: bootstrap?.commitMessage ?? unavailableCommitMessageCapability,
		remoteBridgeCapability: bootstrap?.remoteBridge ?? unavailableRemoteBridgeCapability,
		speechCapability: bootstrap?.speech ?? unavailableSpeechCapability,
		terminalCapability: bootstrap?.terminal ?? unavailableTerminalCapability,
	};
}
