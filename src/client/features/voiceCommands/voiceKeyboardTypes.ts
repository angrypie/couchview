export interface VoiceKeyboardController {
	beginPushToTalk(): boolean;
	cancelPushToTalk(): void;
	finishPushToTalk(): void;
	toggle(): void;
}

export interface VoiceKeyboardActivationOptions {
	active: boolean;
	controller: VoiceKeyboardController;
}
