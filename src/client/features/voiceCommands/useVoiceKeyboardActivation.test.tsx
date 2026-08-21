import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
type VoiceKeyboardController =
	import("./useVoiceKeyboardActivation.web.ts").VoiceKeyboardController;
const { VOICE_PUSH_TO_TALK_MIN_MS, useVoiceKeyboardActivation } = await import(
	"./useVoiceKeyboardActivation.web.ts"
);

afterEach(cleanup);

function controller() {
	const calls = {
		begin: 0,
		cancel: 0,
		finish: 0,
		toggle: 0,
	};
	const value: VoiceKeyboardController = {
		beginPushToTalk: () => {
			calls.begin += 1;
			return true;
		},
		cancelPushToTalk: () => void (calls.cancel += 1),
		finishPushToTalk: () => void (calls.finish += 1),
		toggle: () => void (calls.toggle += 1),
	};
	return { calls, value };
}

function Harness({ active, value }: { active: boolean; value: VoiceKeyboardController }) {
	useVoiceKeyboardActivation({ active, controller: value });
	return <input aria-label="Comment" />;
}

describe("voice keyboard activation", () => {
	test("holds V to talk and finishes only after the push-to-talk threshold", async () => {
		const voice = controller();
		render(<Harness active value={voice.value} />);

		fireEvent.keyDown(window, { code: "KeyV", key: "v" });
		expect(voice.calls.begin).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, VOICE_PUSH_TO_TALK_MIN_MS + 10));
		fireEvent.keyUp(window, { code: "KeyV", key: "v" });

		expect(voice.calls.finish).toBe(1);
		expect(voice.calls.cancel).toBe(0);
	});

	test("discards a short V tap and cancels a held key when focus is lost", () => {
		const voice = controller();
		render(<Harness active value={voice.value} />);

		fireEvent.keyDown(window, { code: "KeyV", key: "v" });
		fireEvent.keyUp(window, { code: "KeyV", key: "v" });
		expect(voice.calls.cancel).toBe(1);
		expect(voice.calls.finish).toBe(0);

		fireEvent.keyDown(window, { code: "KeyV", key: "v" });
		fireEvent.blur(window);
		expect(voice.calls.cancel).toBe(2);
	});

	test("uses Shift V as a non-repeating toggle", () => {
		const voice = controller();
		render(<Harness active value={voice.value} />);

		fireEvent.keyDown(window, { code: "KeyV", key: "V", shiftKey: true });
		fireEvent.keyDown(window, { code: "KeyV", key: "V", repeat: true, shiftKey: true });

		expect(voice.calls.toggle).toBe(1);
		expect(voice.calls.begin).toBe(0);
	});

	test("leaves typing, modified V, and inactive screens alone", () => {
		const voice = controller();
		const view = render(<Harness active value={voice.value} />);
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment" }), {
			code: "KeyV",
			key: "v",
		});
		fireEvent.keyDown(window, { code: "KeyV", ctrlKey: true, key: "v" });
		view.rerender(<Harness active={false} value={voice.value} />);
		fireEvent.keyDown(window, { code: "KeyV", key: "v" });

		expect(voice.calls).toEqual({ begin: 0, cancel: 0, finish: 0, toggle: 0 });
	});
});
