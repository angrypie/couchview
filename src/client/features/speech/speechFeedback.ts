import * as Haptics from "expo-haptics";

import type { SpeechFeedbackEvent } from "./types.ts";

interface HapticsPort {
	impactAsync(style: Haptics.ImpactFeedbackStyle): Promise<void>;
	notificationAsync(type: Haptics.NotificationFeedbackType): Promise<void>;
	performAndroidHapticsAsync(type: Haptics.AndroidHaptics): Promise<void>;
}

export async function emitSpeechFeedback(
	event: SpeechFeedbackEvent,
	platform = process.env.EXPO_OS,
	haptics: HapticsPort = Haptics,
): Promise<void> {
	try {
		if (platform === "android") {
			const androidEvent = {
				started: Haptics.AndroidHaptics.Toggle_On,
				stopped: Haptics.AndroidHaptics.Toggle_Off,
				inserted: Haptics.AndroidHaptics.Confirm,
				failed: Haptics.AndroidHaptics.Reject,
			}[event];
			await haptics.performAndroidHapticsAsync(androidEvent);
			return;
		}
		if (event === "started" || event === "stopped") {
			await haptics.impactAsync(
				event === "started"
					? Haptics.ImpactFeedbackStyle.Light
					: Haptics.ImpactFeedbackStyle.Medium,
			);
			return;
		}
		await haptics.notificationAsync(
			event === "inserted"
				? Haptics.NotificationFeedbackType.Success
				: Haptics.NotificationFeedbackType.Error,
		);
	} catch {
		// Feedback is enhancement-only and must never affect dictation.
	}
}
