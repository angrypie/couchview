import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";
import { installGhosttyCellThemeAdapter, toGhosttyTheme } from "./ghosttyThemeRuntime.ts";
import { adjustedTerminalCellMetrics } from "./terminalCellMetrics.ts";
import { installTerminalClipboardPaste } from "./terminalClipboardPaste.ts";
import { TerminalEchoPaintController } from "./terminalEchoPaint.ts";
import {
	type TerminalKeyInput,
	terminalControlCharacter,
	terminalKeyboardCode,
	terminalModifierOnlyKey,
} from "./terminalKeyboard.ts";
import { installTerminalKeyRepeat } from "./terminalKeyRepeat.ts";
import {
	codeFontStack,
	type TerminalRendererConfig,
	type TerminalRendererTheme,
} from "./typographyPreferences.ts";

export interface BrowserTerminalRenderer {
	readonly cols: number;
	readonly rows: number;
	write(data: Uint8Array<ArrayBuffer>, profile?: BrowserTerminalWriteProfile): void;
	sendKey(input: TerminalKeyInput): void;
	setVirtualControl(active: boolean): void;
	setLatencyKeyHandler(handler: ((event: KeyboardEvent) => void) | null): void;
	updateTheme(theme: TerminalRendererTheme): void;
	focus(): void;
	fit(): void;
	dispose(): void;
}

export interface BrowserTerminalPreviewRenderer {
	updateConfig(config: TerminalRendererConfig): Promise<void>;
	dispose(): void;
}

export interface BrowserTerminalWriteProfile {
	onWriteComplete(): void;
	onRenderStart(): void;
	onRenderComplete(): void;
}

interface CreateBrowserTerminalOptions {
	container: HTMLElement;
	config: TerminalRendererConfig;
	onData(data: Uint8Array<ArrayBuffer>): boolean;
	onResize(cols: number, rows: number): void;
	onVirtualControlChange?(active: boolean): void;
}

interface CreateBrowserTerminalPreviewOptions {
	container: HTMLElement;
	config: TerminalRendererConfig;
}

let initialization: Promise<import("ghostty-web").Ghostty> | null = null;
const encoder = new TextEncoder();
const BUNDLED_TEXT_FONT_FAMILY = "Iosevka";

async function loadGhostty() {
	const ghostty = await import("ghostty-web");
	initialization ??= ghostty.Ghostty.load(ghosttyWasmUrl).catch((error) => {
		initialization = null;
		throw error;
	});
	return {
		ghostty,
		instance: await initialization,
	};
}

async function loadTerminalFont(config: TerminalRendererConfig): Promise<void> {
	if (config.fontFamily === "iosevka") {
		await document.fonts?.load(`${config.fontSize}px "${BUNDLED_TEXT_FONT_FAMILY}"`);
	}
}

function applyTerminalAdjustedMetrics(
	terminal: import("ghostty-web").Terminal,
	config: TerminalRendererConfig,
): void {
	const renderer = terminal.renderer;
	if (!renderer) return;
	renderer.remeasureFont();
	const adjustedMetrics = adjustedTerminalCellMetrics(renderer.getMetrics(), config);
	// ghostty-web 0.4 has no public cell-metric adjustment API. Its TypeScript
	// private field is a normal runtime property, so keep this adaptation small
	// and guarded until upstream exposes line-height and letter-spacing options.
	(renderer as unknown as { metrics: typeof adjustedMetrics }).metrics = adjustedMetrics;
	renderer.resize(terminal.cols, terminal.rows);
	renderTerminalBuffer(terminal);
}

function renderTerminalBuffer(terminal: import("ghostty-web").Terminal, forceAll = true): void {
	const renderer = terminal.renderer;
	const wasmTerm = terminal.wasmTerm;
	if (!renderer || !wasmTerm) return;
	const { scrollbarOpacity } = terminal as unknown as {
		scrollbarOpacity: number;
	};
	renderer.render(wasmTerm, forceAll, terminal.viewportY, terminal, scrollbarOpacity);
}

function terminalPreviewForeground(color: string): 30 | 97 {
	const red = Number.parseInt(color.slice(1, 3), 16);
	const green = Number.parseInt(color.slice(3, 5), 16);
	const blue = Number.parseInt(color.slice(5, 7), 16);
	return (red * 299 + green * 587 + blue * 114) / 255_000 > 0.55 ? 30 : 97;
}

function terminalPreviewContent(cols: number, rows: number, theme: TerminalRendererTheme): string {
	const width = Math.max(2, cols);
	const height = Math.max(1, rows);
	const ruler = Array.from({ length: width }, () => "·");
	for (let marker = 10; marker <= width; marker += 10) {
		const label = String(marker);
		const start = marker - label.length;
		for (let index = 0; index < label.length; index += 1) {
			ruler[start + index] = label[index]!;
		}
	}

	const lualineRow = Math.max(1, height - 2);
	const tmuxRow = height;
	const location = " utf-8  3:18 ";
	const locationColumn = Math.max(1, width - location.length + 1);
	const commandRow = Math.min(3, Math.max(1, lualineRow - 1));
	const blueForeground = terminalPreviewForeground(theme.palette[4]!);
	const cyanForeground = terminalPreviewForeground(theme.palette[6]!);
	return [
		"\x1b[?25l\x1b[2J\x1b[H",
		"\x1b[49m\x1b[90m",
		ruler.join(""),
		`\x1b[${commandRow};1H\x1b[49m\x1b[92m❯`,
		"\x1b[39m nvim ~/.config/nvim/init.lua",
		`\x1b[${lualineRow};1H`,
		`\x1b[1m\x1b[44m\x1b[${blueForeground}m NORMAL `,
		"\x1b[49m\x1b[34m",
		"\x1b[22m\x1b[39m settings.lua ",
		`\x1b[${lualineRow};${locationColumn}H`,
		"\x1b[90m",
		location,
		`\x1b[${tmuxRow};1H`,
		`\x1b[1m\x1b[44m\x1b[${blueForeground}m 0 `,
		"\x1b[49m\x1b[34m",
		"\x1b[22m\x1b[39m bun ",
		`\x1b[1m\x1b[46m\x1b[${cyanForeground}m 1 nvim * `,
		"\x1b[0m\x1b[?25l",
	].join("");
}

export async function createBrowserTerminalPreview(
	options: CreateBrowserTerminalPreviewOptions,
): Promise<BrowserTerminalPreviewRenderer> {
	const { ghostty, instance } = await loadGhostty();
	await loadTerminalFont(options.config);
	const terminal = new ghostty.Terminal({
		cols: 80,
		rows: 8,
		cursorBlink: false,
		cursorStyle: options.config.cursorStyle,
		disableStdin: true,
		fontFamily: codeFontStack(options.config.fontFamily),
		fontSize: options.config.fontSize,
		ghostty: instance,
		scrollback: 0,
		theme: toGhosttyTheme(options.config.theme),
	});
	const fitAddon = new ghostty.FitAddon();
	terminal.loadAddon(fitAddon);
	const previouslyFocused =
		document.activeElement instanceof HTMLElement ? document.activeElement : null;
	terminal.open(options.container);
	const initialTheme = toGhosttyTheme(options.config.theme);
	const cellThemeAdapter = installGhosttyCellThemeAdapter(terminal.wasmTerm!, initialTheme);
	options.container.setAttribute("aria-hidden", "true");
	options.container.setAttribute("contenteditable", "false");
	options.container.setAttribute("tabindex", "-1");
	terminal.textarea?.setAttribute("aria-hidden", "true");
	terminal.textarea?.setAttribute("tabindex", "-1");
	terminal.blur();
	const restoreFocusTimer = window.setTimeout(() => {
		terminal.blur();
		if (previouslyFocused?.isConnected) previouslyFocused.focus();
	}, 0);

	let config = options.config;
	let disposed = false;
	let updateRevision = 0;
	const renderPreview = () => {
		if (!disposed) {
			terminal.write(terminalPreviewContent(terminal.cols, terminal.rows, config.theme));
		}
	};
	const resizeSubscription = terminal.onResize(renderPreview);
	applyTerminalAdjustedMetrics(terminal, config);
	fitAddon.observeResize();
	fitAddon.fit();
	renderPreview();

	return {
		async updateConfig(nextConfig) {
			const revision = ++updateRevision;
			await loadTerminalFont(nextConfig);
			if (disposed || revision !== updateRevision) return;
			config = nextConfig;
			terminal.options.fontFamily = codeFontStack(config.fontFamily);
			terminal.options.fontSize = config.fontSize;
			const nextTheme = toGhosttyTheme(config.theme);
			cellThemeAdapter.update(nextTheme);
			terminal.renderer?.setTheme(nextTheme);
			applyTerminalAdjustedMetrics(terminal, config);
			fitAddon.fit();
			renderPreview();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			updateRevision += 1;
			window.clearTimeout(restoreFocusTimer);
			resizeSubscription.dispose();
			cellThemeAdapter.dispose();
			fitAddon.dispose();
			terminal.dispose();
		},
	};
}

export async function createBrowserTerminal(
	options: CreateBrowserTerminalOptions,
): Promise<BrowserTerminalRenderer> {
	const { ghostty, instance: ghosttyInstance } = await loadGhostty();
	const { config } = options;
	await loadTerminalFont(config);
	const fontFamily = codeFontStack(config.fontFamily);

	const terminal = new ghostty.Terminal({
		cursorBlink: config.cursorBlink,
		cursorStyle: config.cursorStyle,
		fontFamily,
		fontSize: config.fontSize,
		scrollback: 5_000,
		ghostty: ghosttyInstance,
		theme: toGhosttyTheme(config.theme),
	});
	const fitAddon = new ghostty.FitAddon();
	terminal.loadAddon(fitAddon);
	terminal.open(options.container);
	const initialTheme = toGhosttyTheme(config.theme);
	const cellThemeAdapter = installGhosttyCellThemeAdapter(terminal.wasmTerm!, initialTheme);
	const disposeClipboardPaste = installTerminalClipboardPaste(options.container);
	const disposeKeyRepeat = installTerminalKeyRepeat(options.container);
	const terminalRenderer = terminal.renderer;
	const originalRender = terminalRenderer?.render;
	const echoPaintController = new TerminalEchoPaintController();
	let hostWriteDepth = 0;
	let virtualControlActive = false;
	let pendingCanvasRenders: BrowserTerminalWriteProfile[] | null = null;
	let keySubscription: { dispose(): void } | null = null;
	const setLatencyKeyHandler = (handler: ((event: KeyboardEvent) => void) | null) => {
		keySubscription?.dispose();
		keySubscription = null;
		pendingCanvasRenders?.splice(0);
		pendingCanvasRenders = null;
		if (terminalRenderer && originalRender) terminalRenderer.render = originalRender;
		if (!handler || !terminalRenderer || !originalRender) return;

		pendingCanvasRenders = [];
		terminalRenderer.render = (...args: Parameters<typeof terminalRenderer.render>) => {
			const profiles = pendingCanvasRenders?.splice(0) ?? [];
			for (const profile of profiles) profile.onRenderStart();
			originalRender.apply(terminalRenderer, args);
			for (const profile of profiles) profile.onRenderComplete();
		};
		keySubscription = terminal.onKey(({ domEvent }) => {
			if (!virtualControlActive) handler(domEvent);
		});
	};
	const applyAdjustedMetrics = () => {
		applyTerminalAdjustedMetrics(terminal, config);
	};
	const setVirtualControl = (active: boolean) => {
		if (virtualControlActive === active) return;
		virtualControlActive = active;
		options.onVirtualControlChange?.(active);
	};
	const sendKey = (input: TerminalKeyInput) => {
		const ctrlKey = Boolean(input.ctrlKey || virtualControlActive);
		if (virtualControlActive) setVirtualControl(false);
		const controlCharacter =
			ctrlKey && !input.altKey && !input.metaKey ? terminalControlCharacter(input.key) : null;
		if (controlCharacter !== null) {
			terminal.input(controlCharacter, true);
			return;
		}
		const code = terminalKeyboardCode(input.key, input.code);
		if (!code) return;
		terminal.element?.dispatchEvent(
			new KeyboardEvent("keydown", {
				altKey: input.altKey,
				bubbles: true,
				cancelable: true,
				code,
				ctrlKey,
				key: input.key,
				metaKey: input.metaKey,
				shiftKey: input.shiftKey,
			}),
		);
	};
	terminal.attachCustomKeyEventHandler((event) => {
		if (!virtualControlActive || event.ctrlKey || event.metaKey) return false;
		if (terminalModifierOnlyKey(event.key)) return false;
		sendKey({
			altKey: event.altKey,
			code: event.code,
			key: event.key,
			shiftKey: event.shiftKey,
		});
		return true;
	});
	applyAdjustedMetrics();
	const dataSubscription = terminal.onData((data) => {
		const bytes = encoder.encode(data);
		if (hostWriteDepth > 0) {
			options.onData(bytes);
			return;
		}
		const token = echoPaintController.beginInput();
		if (!options.onData(bytes)) {
			echoPaintController.rejectInput(token);
		}
	});
	const resizeSubscription = terminal.onResize(({ cols, rows }) => {
		options.onResize(cols, rows);
	});
	fitAddon.observeResize();
	fitAddon.fit();
	return {
		get cols() {
			return terminal.cols;
		},
		get rows() {
			return terminal.rows;
		},
		sendKey,
		setVirtualControl,
		write(data, profile) {
			if (pendingCanvasRenders && profile) {
				pendingCanvasRenders.push(profile);
			}
			try {
				hostWriteDepth += 1;
				try {
					terminal.write(data);
				} finally {
					hostWriteDepth -= 1;
				}
				profile?.onWriteComplete();
				echoPaintController.renderFirstOutput(() => {
					// ghostty-web#179 ships this behavior on main, but 0.4.0 predates it.
					// Keep this adapter local until the next upstream release is available.
					renderTerminalBuffer(terminal, false);
				});
			} catch (error) {
				if (pendingCanvasRenders && profile) {
					const profileIndex = pendingCanvasRenders.lastIndexOf(profile);
					if (profileIndex >= 0) pendingCanvasRenders.splice(profileIndex, 1);
				}
				throw error;
			}
		},
		setLatencyKeyHandler,
		updateTheme(theme) {
			const nextTheme = toGhosttyTheme(theme);
			cellThemeAdapter.update(nextTheme);
			terminal.renderer?.setTheme(nextTheme);
			renderTerminalBuffer(terminal);
		},
		focus() {
			terminal.focus();
		},
		fit() {
			fitAddon.fit();
		},
		dispose() {
			disposeClipboardPaste();
			disposeKeyRepeat();
			cellThemeAdapter.dispose();
			echoPaintController.reset();
			dataSubscription.dispose();
			setLatencyKeyHandler(null);
			resizeSubscription.dispose();
			fitAddon.dispose();
			terminal.dispose();
		},
	};
}
