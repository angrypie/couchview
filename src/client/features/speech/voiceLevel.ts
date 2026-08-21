import type { SpeechLevelListener, SpeechLevelSource } from "./types.ts";

export const SPEECH_LEVEL_UPDATE_INTERVAL_MS = 64;

const ATTACK_SMOOTHING = 0.65;
const RELEASE_SMOOTHING = 0.5;
const LEVEL_EPSILON = 0.001;

export interface SpeechLevelSignal extends SpeechLevelSource {
	push(level: number): void;
	reset(): void;
}

interface SpeechLevelSignalOptions {
	minimumIntervalMs?: number;
	now?: () => number;
}

function clampLevel(level: number): number {
	if (!Number.isFinite(level)) return 0;
	return Math.max(0, Math.min(1, level));
}

function defaultNow(): number {
	return typeof performance === "undefined" ? Date.now() : performance.now();
}

export const silentSpeechLevelSource: SpeechLevelSource = {
	getCurrentLevel: () => 0,
	subscribe(listener) {
		listener(0);
		return () => undefined;
	},
};

export function createSpeechLevelSignal(options: SpeechLevelSignalOptions = {}): SpeechLevelSignal {
	const listeners = new Set<SpeechLevelListener>();
	const minimumIntervalMs = options.minimumIntervalMs ?? SPEECH_LEVEL_UPDATE_INTERVAL_MS;
	const now = options.now ?? defaultNow;
	let currentLevel = 0;
	let lastPublishedAt: number | null = null;
	let pendingPeak = 0;

	const publish = (nextLevel: number) => {
		currentLevel = nextLevel;
		for (const listener of listeners) listener(currentLevel);
	};

	return {
		getCurrentLevel: () => currentLevel,
		push(level) {
			pendingPeak = Math.max(pendingPeak, clampLevel(level));
			const timestamp = now();
			if (
				lastPublishedAt !== null &&
				timestamp - lastPublishedAt < Math.max(0, minimumIntervalMs)
			) {
				return;
			}
			lastPublishedAt = timestamp;
			const observedLevel = pendingPeak;
			pendingPeak = 0;
			const smoothing = observedLevel >= currentLevel ? ATTACK_SMOOTHING : RELEASE_SMOOTHING;
			const smoothedLevel = currentLevel + (observedLevel - currentLevel) * smoothing;
			publish(smoothedLevel < LEVEL_EPSILON ? 0 : smoothedLevel);
		},
		reset() {
			lastPublishedAt = null;
			pendingPeak = 0;
			if (currentLevel !== 0) publish(0);
		},
		subscribe(listener) {
			listeners.add(listener);
			listener(currentLevel);
			return () => listeners.delete(listener);
		},
	};
}
