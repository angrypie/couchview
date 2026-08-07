import { mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { FileDiff } from "../shared/contracts.ts";
import type { ResolvedTheme } from "../shared/theme.ts";
import type { AppRouteConfiguration } from "./App.tsx";
import { nativeTestRuntime } from "./appTestNativeRuntime.tsx";
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
	useResolveClassNames: () => ({ color: "#111827" }),
	useUniwind: useTestUniwind,
	withUniwind: <Component,>(component: Component) => component,
}));

export const viewerHunkJumps: number[] = [];
export const viewerState: {
	visibleLineChange: ((lineNumber: number, side: "old" | "new") => void) | null;
} = {
	visibleLineChange: null,
};
interface MockDiffViewerProps {
	diff: FileDiff;
	fontFamily: string;
	fontSize: number;
	lineHeightAdjustment: number;
	widthAdjustment: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	themeType?: ResolvedTheme;
	onIdentifierClick(identifier: string): void;
	onVisibleLineChange(lineNumber: number, side: "old" | "new"): void;
}
mock.module("./DiffViewer.tsx", () => ({
	DiffViewer: React.forwardRef(function MockDiffViewer(
		{
			diff,
			fontFamily,
			fontSize,
			lineHeightAdjustment,
			widthAdjustment,
			lineNumbersVisible,
			lineWrapEnabled,
			themeType,
			onIdentifierClick,
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
								<span data-testid={`old-line-${line.oldLine}`}>{line.oldLine}</span>
							)}
							{lineNumbersVisible && line.newLine !== null && (
								<span data-testid={`new-line-${line.newLine}`}>{line.newLine}</span>
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
export { nativeTestRuntime };

const { App: ProductApp } = await import("./App.tsx");
const { ThemeProvider } = await import("./features/settings/ThemeProvider.tsx");
const { AppStoreProvider, createAppStore } = await import("./lib/store/appStore.tsx");

export function App(props: AppRouteConfiguration = {}) {
	const [store] = React.useState(createAppStore);
	return (
		<AppStoreProvider store={store}>
			<ThemeProvider>
				<ProductApp {...props} />
			</ThemeProvider>
		</AppStoreProvider>
	);
}

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
