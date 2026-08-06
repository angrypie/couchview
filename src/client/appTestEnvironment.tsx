import { mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { FileDiff, ReviewComment } from "../shared/contracts.ts";
import type { ResolvedTheme } from "../shared/theme.ts";
import { terminalPreviewRendererFactory, terminalRendererFactory } from "./terminalTestFakes.ts";
import { DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER } from "./typographyPreferences.ts";

mock.module("./ghosttyTerminal.ts", () => ({
	createBrowserTerminal: terminalRendererFactory,
	createBrowserTerminalPreview: terminalPreviewRendererFactory,
}));

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const React = await import("react");

type TestThemeSnapshot = {
	hasAdaptiveThemes: boolean;
	theme: "light" | "dark";
};

interface TestThemeWrite {
	preference: "system" | "light" | "dark";
	transition?: { preset: number };
}

let testSystemTheme: TestThemeSnapshot["theme"] = "dark";
let testThemeSnapshot: TestThemeSnapshot = { hasAdaptiveThemes: true, theme: testSystemTheme };
const testThemeListeners = new Set<() => void>();
const testThemeWrites: TestThemeWrite[] = [];

function publishTestTheme(snapshot: TestThemeSnapshot): void {
	document.documentElement.classList.remove("light", "dark");
	document.documentElement.classList.add(snapshot.theme);
	if (
		testThemeSnapshot.hasAdaptiveThemes === snapshot.hasAdaptiveThemes &&
		testThemeSnapshot.theme === snapshot.theme
	) {
		return;
	}
	testThemeSnapshot = snapshot;
	for (const listener of testThemeListeners) listener();
}

function useTestUniwind() {
	return React.useSyncExternalStore(
		(listener) => {
			testThemeListeners.add(listener);
			return () => {
				testThemeListeners.delete(listener);
			};
		},
		() => testThemeSnapshot,
		() => testThemeSnapshot,
	);
}

export const testThemeRuntime = {
	get writes(): readonly TestThemeWrite[] {
		return testThemeWrites;
	},
	reset() {
		testSystemTheme = "dark";
		testThemeWrites.length = 0;
		publishTestTheme({ hasAdaptiveThemes: true, theme: testSystemTheme });
	},
	setSystemTheme(theme: TestThemeSnapshot["theme"]) {
		testSystemTheme = theme;
		if (testThemeSnapshot.hasAdaptiveThemes) {
			publishTestTheme({ hasAdaptiveThemes: true, theme });
		}
	},
};

mock.module("uniwind", () => ({
	ThemeTransitionPreset: {
		Fade: 1,
		None: 0,
	},
	Uniwind: {
		get currentTheme() {
			return testThemeSnapshot.theme;
		},
		get hasAdaptiveThemes() {
			return testThemeSnapshot.hasAdaptiveThemes;
		},
		setTheme(preference: "system" | "light" | "dark", transition?: { preset: number }) {
			testThemeWrites.push({ preference, transition });
			publishTestTheme({
				hasAdaptiveThemes: preference === "system",
				theme: preference === "system" ? testSystemTheme : preference,
			});
		},
	},
	useUniwind: useTestUniwind,
}));

export const viewerCommentJumps: string[] = [];
export const viewerHunkJumps: number[] = [];
export const viewerState: {
	visibleLineChange: ((lineNumber: number, side: "old" | "new") => void) | null;
} = {
	visibleLineChange: null,
};
interface MockDiffViewerProps {
	comments: readonly ReviewComment[];
	diff: FileDiff;
	fontFamily: string;
	fontSize: number;
	lineHeightAdjustment: number;
	widthAdjustment: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	themeType?: ResolvedTheme;
	onCommentClick(comment: ReviewComment): void;
	onIdentifierClick(identifier: string): void;
	onLineNumberClick(lineNumber: number, side: "old" | "new"): void;
	onVisibleLineChange(lineNumber: number, side: "old" | "new"): void;
}
mock.module("./DiffViewer.tsx", () => ({
	DiffViewer: React.forwardRef(function MockDiffViewer(
		{
			comments,
			diff,
			fontFamily,
			fontSize,
			lineHeightAdjustment,
			widthAdjustment,
			lineNumbersVisible,
			lineWrapEnabled,
			themeType,
			onCommentClick,
			onIdentifierClick,
			onLineNumberClick,
			onVisibleLineChange,
		}: MockDiffViewerProps,
		ref: React.ForwardedRef<unknown>,
	) {
		viewerState.visibleLineChange = onVisibleLineChange;
		React.useImperativeHandle(ref, () => ({
			scrollToLine() {},
			scrollToHunk(hunkIndex: number) {
				viewerHunkJumps.push(hunkIndex);
			},
			scrollToComment(comment: ReviewComment) {
				viewerCommentJumps.push(comment.id);
			},
			scrollToTop() {},
		}));
		return (
			<div
				className="pierre-code-view"
				data-line-wrap={String(lineWrapEnabled)}
				data-theme-type={themeType}
				data-testid="pierre-code-view"
				style={{
					fontFamily,
					fontSize: `${fontSize}px`,
					letterSpacing: `${widthAdjustment}px`,
					lineHeight: `${fontSize * DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER + lineHeightAdjustment}px`,
				}}
			>
				{diff.hunks.flatMap((hunk) =>
					hunk.lines.map((line) => (
						<div data-kind={line.kind} key={`${hunk.id}:${line.id}`}>
							{lineNumbersVisible && line.oldLine !== null && (
								<button
									aria-label={`Select old line ${line.oldLine}`}
									onClick={() => onLineNumberClick(line.oldLine!, "old")}
									type="button"
								>
									{line.oldLine}
								</button>
							)}
							{lineNumbersVisible && line.newLine !== null && (
								<button
									aria-label={`Select new line ${line.newLine}`}
									onClick={() => onLineNumberClick(line.newLine!, "new")}
									type="button"
								>
									{line.newLine}
								</button>
							)}
							{line.text.split(/([A-Za-z_$][\w$-]*)/g).map((token, index) =>
								/^[A-Za-z_$][\w$-]*$/.test(token) ? (
									<button
										key={`${index}:${token}`}
										onClick={() => onIdentifierClick(token)}
										title={`Find “${token}” in project`}
										type="button"
									>
										{token}
									</button>
								) : (
									<span key={`${index}:${token}`}>{token}</span>
								),
							)}
						</div>
					)),
				)}
				{comments
					.filter((comment) => comment.fileId === diff.fileId && !comment.stale)
					.map((comment) => (
						<button
							aria-label={`Open comment at ${comment.path}`}
							key={comment.id}
							onClick={() => onCommentClick(comment)}
							type="button"
						>
							{comment.body}
						</button>
					))}
			</div>
		);
	}),
}));

Object.defineProperty(HTMLElement.prototype, "clientHeight", {
	configurable: true,
	get() {
		return this.classList.contains("pierre-code-view") ? 640 : 44;
	},
});
Object.defineProperty(HTMLElement.prototype, "clientWidth", {
	configurable: true,
	get() {
		return this.classList.contains("pierre-code-view") ? 375 : 120;
	},
});
HTMLElement.prototype.getBoundingClientRect = function () {
	const width = this.classList.contains("pierre-code-view") ? 375 : 120;
	const height = this.classList.contains("pierre-code-view") ? 640 : 44;
	return {
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: width,
		bottom: height,
		width,
		height,
		toJSON: () => ({}),
	};
};
class ResizeObserverStub {
	constructor(private readonly callback: ResizeObserverCallback) {}
	observe(target: Element) {
		const contentRect = target.getBoundingClientRect();
		this.callback(
			[
				{
					target,
					contentRect,
					borderBoxSize: [],
					contentBoxSize: [],
					devicePixelContentBoxSize: [],
				} as unknown as ResizeObserverEntry,
			],
			this as unknown as ResizeObserver,
		);
	}
	unobserve() {}
	disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", {
	configurable: true,
	value: ResizeObserverStub,
});
Object.defineProperty(window, "ResizeObserver", {
	configurable: true,
	value: ResizeObserverStub,
});
export const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
	"@testing-library/react"
);
export const { App } = await import("./App.tsx");
export const originalFetch = globalThis.fetch;
export const originalWebSocket = globalThis.WebSocket;

export class EventSourceStub {
	static instances: EventSourceStub[] = [];
	onopen: ((event: Event) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	constructor() {
		EventSourceStub.instances.push(this);
	}
	close() {}
}

export function fixtureComment(id: string, body: string, stale = false): Record<string, unknown> {
	return {
		id,
		fileId: "first",
		path: "src/first.ts",
		side: "mixed",
		startLine: 1,
		endLine: 1,
		oldStartLine: 1,
		oldEndLine: 1,
		newStartLine: 1,
		newEndLine: 1,
		hunkHeader: "@@ -1,2 +1,2 @@",
		excerpt: ["- const value = load(oldPath);", "+ const value = load(newPath);"],
		body,
		contentRevision: "first-v1",
		stale,
		createdAt: "2026-07-20T10:00:00.000Z",
		updatedAt: "2026-07-20T10:00:00.000Z",
	};
}
