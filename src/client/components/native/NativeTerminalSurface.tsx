"use dom";

import { useEffect, useRef, useState } from "react";

import { TERMINAL_TICKET_PREFIX } from "../../../shared/contracts.ts";
import type { ResolvedTheme } from "../../../shared/theme.ts";
import {
	installNativeTerminalThemeController,
	NATIVE_TERMINAL_THEMES,
	type NativeTerminalThemeController,
} from "./nativeTerminalTheme.ts";

const ghosttyWasmAsset = require("ghostty-web/ghostty-vt.wasm") as string;

interface NativeTerminalSurfaceProps {
	socketUrl: string;
	ticket: string;
	fontSize: number;
	protocol: "couchview-terminal-v1";
	theme: ResolvedTheme;
	onDisconnected(message: string): Promise<void>;
	dom?: import("expo/dom").DOMProps;
}

export default function NativeTerminalSurface({
	socketUrl,
	ticket,
	fontSize,
	protocol,
	theme,
	onDisconnected,
}: NativeTerminalSurfaceProps) {
	const container = useRef<HTMLDivElement>(null);
	const themeControllerRef = useRef<NativeTerminalThemeController | null>(null);
	const themeRef = useRef(theme);
	themeRef.current = theme;
	const [status, setStatus] = useState("Connecting…");
	useEffect(() => {
		document.documentElement.dataset.resolvedTheme = theme;
		document.documentElement.style.colorScheme = theme;
		themeControllerRef.current?.apply(theme);
	}, [theme]);
	useEffect(() => {
		let disposed = false;
		let socket: WebSocket | null = null;
		let activeTerminal: import("ghostty-web").Terminal | null = null;
		let fitAddon: import("ghostty-web").FitAddon | null = null;
		let activeThemeController: NativeTerminalThemeController | null = null;
		void (async () => {
			const ghostty = await import("ghostty-web");
			const instance = await ghostty.Ghostty.load(ghosttyWasmAsset);
			if (disposed || !container.current) return;
			const initialTheme = themeRef.current;
			activeTerminal = new ghostty.Terminal({
				cols: 80,
				rows: 24,
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
				fontSize,
				ghostty: instance,
				theme: NATIVE_TERMINAL_THEMES[initialTheme],
			});
			fitAddon = new ghostty.FitAddon();
			activeTerminal.loadAddon(fitAddon);
			activeTerminal.open(container.current);
			activeThemeController = installNativeTerminalThemeController(activeTerminal, initialTheme);
			themeControllerRef.current = activeThemeController;
			activeThemeController?.apply(themeRef.current);
			fitAddon.observeResize();
			fitAddon.fit();
			socket = new WebSocket(socketUrl, [protocol, `${TERMINAL_TICKET_PREFIX}${ticket}`]);
			socket.binaryType = "arraybuffer";
			socket.onopen = () => {
				setStatus("Connected");
				if (activeTerminal)
					socket?.send(
						JSON.stringify({
							type: "resize",
							cols: activeTerminal.cols,
							rows: activeTerminal.rows,
						}),
					);
			};
			socket.onmessage = (event) => {
				if (event.data instanceof ArrayBuffer) activeTerminal?.write(new Uint8Array(event.data));
				else if (typeof event.data === "string") {
					try {
						const control = JSON.parse(event.data) as { type?: string; message?: string };
						if (control.type === "error") setStatus(control.message ?? "Terminal error");
					} catch {
						activeTerminal?.write(event.data);
					}
				}
			};
			socket.onclose = (event) => {
				if (disposed) return;
				const message = event.reason || "Terminal disconnected";
				setStatus(message);
				void onDisconnected(message);
			};
			activeTerminal.onData((data) => {
				if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
			});
			activeTerminal.onResize(({ cols, rows }) => {
				if (socket?.readyState === WebSocket.OPEN) {
					socket.send(JSON.stringify({ type: "resize", cols, rows }));
				}
			});
		})().catch((error) => {
			if (disposed) return;
			const message = error instanceof Error ? error.message : "Terminal failed to start";
			setStatus(message);
			void onDisconnected(message);
		});
		return () => {
			disposed = true;
			socket?.close();
			activeThemeController?.dispose();
			fitAddon?.dispose();
			activeTerminal?.dispose();
			if (themeControllerRef.current === activeThemeController) {
				themeControllerRef.current = null;
			}
		};
	}, [fontSize, onDisconnected, protocol, socketUrl, ticket]);
	const colors = NATIVE_TERMINAL_THEMES[theme];
	return (
		<main style={{ background: colors.background, color: colors.foreground, height: "100vh" }}>
			<div
				aria-live="polite"
				style={{
					color: theme === "dark" ? "#8f9baa" : "#5d6a7b",
					font: "12px system-ui",
					padding: 6,
				}}
			>
				{status}
			</div>
			<div ref={container} style={{ height: "calc(100vh - 30px)", width: "100%" }} />
		</main>
	);
}
