import type { SpeechPhase } from "./types.ts";

const transitions: Record<SpeechPhase, readonly SpeechPhase[]> = {
	idle: ["requestingPermission"],
	requestingPermission: ["recording", "idle", "error"],
	recording: ["transcribing", "idle", "error"],
	transcribing: ["idle", "error"],
	error: ["idle", "requestingPermission"],
};

export function transitionSpeechPhase(current: SpeechPhase, next: SpeechPhase): SpeechPhase {
	if (current === next) return current;
	if (!transitions[current].includes(next)) {
		throw new Error(`Invalid speech transition: ${current} -> ${next}`);
	}
	return next;
}
