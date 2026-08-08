import { afterEach, describe, expect, test } from "bun:test";

import type { SpeechCapability, SpeechTranscriptionResponse } from "../../../shared/contracts.ts";
import type { SpeechRecordingAdapter, SpeechTarget } from "./types.ts";

const { cleanup, fireEvent, render, screen, waitFor } = await import(
	"../../appTestEnvironment.tsx"
);
const { SpeechProvider, useSpeech } = await import("./SpeechProvider.tsx");

afterEach(cleanup);

function capability(maxDurationMs = 300_000): SpeechCapability {
	return {
		enabled: true,
		maxDurationMs,
		maxUploadBytes: 32 * 1024 * 1024,
		model: "test-parakeet",
		ready: true,
		reason: null,
	};
}

function capture() {
	return { chunks: [new Uint8Array(16_000)], sampleRate: 16_000 };
}

function target(
	id: string,
	value = "hello old world",
	selection = { start: 6, end: 9 },
): SpeechTarget & { applied: string[] } {
	const applied: string[] = [];
	let currentValue = value;
	let currentSelection = selection;
	return {
		applied,
		apply(nextValue, nextSelection) {
			currentValue = nextValue;
			currentSelection = nextSelection;
			applied.push(nextValue);
		},
		getSelection: () => currentSelection,
		getValue: () => currentValue,
		id,
		maxLength: 100,
	};
}

function Harness({ first, second }: { first: SpeechTarget; second?: SpeechTarget }) {
	const speech = useSpeech();
	return (
		<>
			<div data-testid="speech-phase">{speech.phase}</div>
			<div data-testid="speech-error">{speech.error}</div>
			<button onClick={() => speech.toggle(first)} type="button">
				First mic
			</button>
			{second ? (
				<button onClick={() => speech.toggle(second)} type="button">
					Second mic
				</button>
			) : null}
		</>
	);
}

function renderController(options: {
	adapter: SpeechRecordingAdapter;
	first: SpeechTarget;
	maxDurationMs?: number;
	second?: SpeechTarget;
	transcribe?: SpeechProviderParameters["transcribeSpeech"];
}) {
	const feedback: string[] = [];
	const view = render(
		<SpeechProvider
			capability={capability(options.maxDurationMs)}
			csrfToken="csrf"
			emitFeedback={async (event) => void feedback.push(event)}
			recordingAdapter={options.adapter}
			transcribeSpeech={
				options.transcribe ??
				(async () => ({ durationMs: 500, inferenceMs: 5, language: null, text: "new" }))
			}
		>
			<Harness first={options.first} second={options.second} />
		</SpeechProvider>,
	);
	return { feedback, view };
}

type SpeechProviderParameters = Parameters<typeof SpeechProvider>[0];

describe("SpeechProvider", () => {
	test("reports permission failure without uploading or modifying the target", async () => {
		const first = target("first");
		let uploads = 0;
		const adapter: SpeechRecordingAdapter = {
			available: true,
			cancel: () => undefined,
			start: async () => {
				throw new Error("Microphone permission was not granted.");
			},
			stop: async () => capture(),
		};
		const { feedback } = renderController({
			adapter,
			first,
			transcribe: async () => {
				uploads += 1;
				return { durationMs: 500, inferenceMs: 1, language: null, text: "ignored" };
			},
		});
		fireEvent.click(screen.getByRole("button", { name: "First mic" }));
		await waitFor(() => expect(screen.getByTestId("speech-phase").textContent).toBe("error"));
		expect(screen.getByTestId("speech-error").textContent).toContain("permission");
		expect(first.applied).toEqual([]);
		expect(uploads).toBe(0);
		expect(feedback).toEqual(["failed"]);
	});

	test("keeps one global session and inserts only after transcription succeeds", async () => {
		const first = target("first");
		const second = target("second");
		let starts = 0;
		let stops = 0;
		const adapter: SpeechRecordingAdapter = {
			available: true,
			cancel: () => undefined,
			start: async () => void (starts += 1),
			stop: async () => {
				stops += 1;
				return capture();
			},
		};
		const { feedback } = renderController({ adapter, first, second });
		fireEvent.click(screen.getByRole("button", { name: "First mic" }));
		await waitFor(() => expect(screen.getByTestId("speech-phase").textContent).toBe("recording"));
		fireEvent.click(screen.getByRole("button", { name: "Second mic" }));
		expect(starts).toBe(1);
		expect(stops).toBe(0);
		fireEvent.click(screen.getByRole("button", { name: "First mic" }));
		await waitFor(() => expect(screen.getByTestId("speech-phase").textContent).toBe("idle"));
		expect(first.applied).toEqual(["hello new world"]);
		expect(second.applied).toEqual([]);
		expect(feedback).toEqual(["started", "stopped", "inserted"]);
	});

	test("auto-stops at the configured host limit", async () => {
		const first = target("first", "", { start: 0, end: 0 });
		let stops = 0;
		const adapter: SpeechRecordingAdapter = {
			available: true,
			cancel: () => undefined,
			start: async () => undefined,
			stop: async () => {
				stops += 1;
				return capture();
			},
		};
		renderController({ adapter, first, maxDurationMs: 20 });
		fireEvent.click(screen.getByRole("button", { name: "First mic" }));
		await waitFor(() => expect(stops).toBe(1));
		await waitFor(() => expect(first.applied).toEqual(["new"]));
	});

	test("cancels an active session when the host connection changes", async () => {
		const first = target("first");
		let cancellations = 0;
		const adapter: SpeechRecordingAdapter = {
			available: true,
			cancel: () => void (cancellations += 1),
			start: async () => undefined,
			stop: async () => capture(),
		};
		const feedback: string[] = [];
		const renderProvider = (connected: boolean) => (
			<SpeechProvider
				capability={capability()}
				connected={connected}
				csrfToken="csrf"
				emitFeedback={async (event) => void feedback.push(event)}
				recordingAdapter={adapter}
			>
				<Harness first={first} />
			</SpeechProvider>
		);
		const view = render(renderProvider(true));
		fireEvent.click(screen.getByRole("button", { name: "First mic" }));
		await waitFor(() => expect(screen.getByTestId("speech-phase").textContent).toBe("recording"));

		view.rerender(renderProvider(false));
		await waitFor(() => expect(screen.getByTestId("speech-phase").textContent).toBe("idle"));
		expect(cancellations).toBe(1);
		expect(first.applied).toEqual([]);
		expect(feedback).toEqual(["started", "stopped"]);
	});

	test("ignores a transcription result after explicit cancellation", async () => {
		const first = target("first");
		let resolveResult: (value: SpeechTranscriptionResponse) => void = () => undefined;
		let requestSignal: AbortSignal | undefined;
		const adapter: SpeechRecordingAdapter = {
			available: true,
			cancel: () => undefined,
			start: async () => undefined,
			stop: async () => capture(),
		};
		renderController({
			adapter,
			first,
			transcribe: (_body, _csrf, signal) => {
				requestSignal = signal;
				return new Promise((resolve) => {
					resolveResult = resolve;
				});
			},
		});
		fireEvent.click(screen.getByRole("button", { name: "First mic" }));
		await waitFor(() => expect(screen.getByTestId("speech-phase").textContent).toBe("recording"));
		fireEvent.click(screen.getByRole("button", { name: "First mic" }));
		await waitFor(() =>
			expect(screen.getByTestId("speech-phase").textContent).toBe("transcribing"),
		);
		fireEvent.click(screen.getByRole("button", { name: "First mic" }));
		expect(requestSignal?.aborted).toBe(true);
		resolveResult({ durationMs: 500, inferenceMs: 1, language: null, text: "stale" });
		await waitFor(() => expect(screen.getByTestId("speech-phase").textContent).toBe("idle"));
		expect(first.applied).toEqual([]);
	});
});
