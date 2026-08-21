import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { useMemo } from "react";

import {
	COMMAND_IDS,
	type CommandId,
	createDefaultSettingsProfileData,
	effectiveKeybindings,
} from "../shared/settings.ts";
import { VOICE_KEYBOARD_STROKES } from "../shared/voiceCommands.ts";
import "./appTestNativeRuntime.tsx";
import type { RuntimeCommand } from "./commands.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { COMMAND_DEFINITIONS } = await import("./commands.ts");
const { formatShortcut, shortcutStrokeFromEvent, useShortcutEngine } = await import(
	"./shortcutEngine.ts"
);

afterEach(cleanup);

function commands(calls: CommandId[]): Record<CommandId, RuntimeCommand> {
	return Object.fromEntries(
		COMMAND_IDS.map((commandId) => [
			commandId,
			{
				...COMMAND_DEFINITIONS[commandId],
				binding: null,
				enabled: true,
				disabledReason: null,
				perform: () => calls.push(commandId),
			},
		]),
	) as unknown as Record<CommandId, RuntimeCommand>;
}

function Harness({
	calls,
	voiceConflict = false,
	voiceActive = false,
	recording = false,
	restricted = false,
}: {
	calls: CommandId[];
	voiceConflict?: boolean;
	voiceActive?: boolean;
	recording?: boolean;
	restricted?: boolean;
}) {
	const bindings = useMemo(() => {
		const next = effectiveKeybindings(createDefaultSettingsProfileData().keyboard);
		if (voiceConflict) next["file.toggleReviewed"] = [{ key: "v", modifiers: [] }];
		return next;
	}, [voiceConflict]);
	const runtimeCommands = useMemo(() => commands(calls), [calls]);
	const result = useShortcutEngine({
		bindings,
		commands: runtimeCommands,
		paletteOpen: false,
		recording,
		reservedStrokes: voiceActive ? VOICE_KEYBOARD_STROKES : undefined,
		restricted,
	});
	return (
		<div>
			<input aria-label="Typing surface" />
			<output data-testid="pending">{formatShortcut(result.pending)}</output>
		</div>
	);
}

describe("shortcut engine", () => {
	test("normalizes Mod and explicit modifiers on Apple and non-Apple platforms", () => {
		const ctrlK = new KeyboardEvent("keydown", { key: "K", ctrlKey: true });
		expect(shortcutStrokeFromEvent(ctrlK, false)).toEqual({ key: "k", modifiers: ["mod"] });
		const commandControlK = new KeyboardEvent("keydown", {
			key: "K",
			ctrlKey: true,
			metaKey: true,
		});
		expect(shortcutStrokeFromEvent(commandControlK, true)).toEqual({
			key: "k",
			modifiers: ["mod", "ctrl"],
		});
		expect(formatShortcut([{ key: "k", modifiers: ["mod", "shift"] }], true)).toBe("⌘⇧K");
		expect(formatShortcut([{ key: "k", modifiers: ["mod", "shift"] }], false)).toBe("Ctrl+Shift+K");
	});

	test("executes single and multi-stroke commands through the same registry", () => {
		const calls: CommandId[] = [];
		render(<Harness calls={calls} />);

		fireEvent.keyDown(window, { key: "g" });
		expect(screen.getByTestId("pending").textContent).toBe("G");
		fireEvent.keyDown(window, { key: "d" });
		expect(calls).toEqual(["navigate.review"]);
		expect(screen.getByTestId("pending").textContent).toBe("Unassigned");

		fireEvent.keyDown(window, { key: "r" });
		expect(calls).toEqual(["navigate.review", "file.toggleReviewed"]);
	});

	test("cancels pending strokes on Escape and after the fixed timeout", async () => {
		const calls: CommandId[] = [];
		render(<Harness calls={calls} />);
		fireEvent.keyDown(window, { key: "g" });
		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.getByTestId("pending").textContent).toBe("Unassigned");

		fireEvent.keyDown(window, { key: "g" });
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1_050));
		});
		expect(screen.getByTestId("pending").textContent).toBe("Unassigned");
		fireEvent.keyDown(window, { key: "d" });
		expect(calls).toEqual([]);
	});

	test("suspends typing surfaces and overlays except for the palette opener", () => {
		const calls: CommandId[] = [];
		const view = render(<Harness calls={calls} />);
		const input = screen.getByLabelText("Typing surface");
		fireEvent.keyDown(input, { key: "r" });
		fireEvent.keyDown(input, { key: "k", ctrlKey: true });
		expect(calls).toEqual(["palette.open"]);

		view.rerender(<Harness calls={calls} restricted />);
		fireEvent.keyDown(window, { key: "r" });
		fireEvent.keyDown(window, { key: "k", ctrlKey: true });
		expect(calls).toEqual(["palette.open", "palette.open"]);
	});

	test("suspends all execution while recording and ignores IME/dead keys", () => {
		const calls: CommandId[] = [];
		const view = render(<Harness calls={calls} recording />);
		fireEvent.keyDown(window, { key: "r" });
		expect(calls).toEqual([]);

		view.rerender(<Harness calls={calls} />);
		fireEvent.keyDown(window, { key: "r", isComposing: true });
		fireEvent.keyDown(window, { key: "Dead" });
		fireEvent.keyDown(window, { key: "r", keyCode: 229 });
		expect(calls).toEqual([]);
	});

	test("reserves the fixed voice strokes only while voice keyboard activation is active", () => {
		const calls: CommandId[] = [];
		const view = render(<Harness calls={calls} voiceActive voiceConflict />);
		fireEvent.keyDown(window, { key: "v" });
		expect(calls).toEqual([]);

		view.rerender(<Harness calls={calls} voiceConflict />);
		fireEvent.keyDown(window, { key: "v" });
		expect(calls).toEqual(["file.toggleReviewed"]);
	});

	test("repeats only repeatable single-stroke navigation commands", () => {
		const calls: CommandId[] = [];
		render(<Harness calls={calls} />);
		fireEvent.keyDown(window, { key: "h", repeat: true });
		fireEvent.keyDown(window, { key: "r", repeat: true });
		fireEvent.keyDown(window, { key: "g", repeat: true });
		fireEvent.keyDown(window, { key: "d" });
		expect(calls).toEqual(["file.previous"]);
		expect(screen.getByTestId("pending").textContent).toBe("Unassigned");
	});
});
