import type { BootstrapResponse, VoiceCommandCapability } from "../../../shared/contracts.ts";

const unavailableVoiceCommandCapability: VoiceCommandCapability = {
	enabled: false,
	ready: false,
	state: "disabled",
	model: "Cactus-Compute/needle2",
	reason: "Start Couchview with --enable-voice-commands to allow voice commands.",
	requiredFlags: ["--enable-speech", "--enable-voice-commands"],
	canRetry: false,
};

export function hostVoiceCommandCapability(bootstrap: BootstrapResponse | null) {
	return bootstrap?.voiceCommands ?? unavailableVoiceCommandCapability;
}

export function withVoiceCommandCapability(
	bootstrap: BootstrapResponse | null,
	voiceCommands: VoiceCommandCapability,
): BootstrapResponse | null {
	if (!bootstrap) return bootstrap;
	return { ...bootstrap, voiceCommands };
}
