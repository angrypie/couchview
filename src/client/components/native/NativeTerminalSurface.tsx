"use dom";

import { useEffect, useRef, useState } from "react";

import { TERMINAL_TICKET_PREFIX } from "../../../shared/contracts.ts";

const ghosttyWasmAsset = require("ghostty-web/ghostty-vt.wasm") as string;

interface NativeTerminalSurfaceProps {
	socketUrl: string;
	ticket: string;
	fontSize: number;
	protocol: "couchview-terminal-v1";
	onDisconnected(message: string): Promise<void>;
	dom?: import("expo/dom").DOMProps;
}

export default function NativeTerminalSurface({
	socketUrl,
	ticket,
	fontSize,
	protocol,
	onDisconnected,
}: NativeTerminalSurfaceProps) {
	const container = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState("Connecting…");
	useEffect(() => {
		let disposed = false;
		let socket: WebSocket | null = null;
		let terminal: import("ghostty-web").Terminal | null = null;
		let fitAddon: import("ghostty-web").FitAddon | null = null;
		void (async () => {
			const ghostty = await import("ghostty-web");
			const instance = await ghostty.Ghostty.load(ghosttyWasmAsset);
			if (disposed || !container.current) return;
			terminal = new ghostty.Terminal({
				cols: 80,
				rows: 24,
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
				fontSize,
				ghostty: instance,
				theme: { background: "#0b0d10", foreground: "#e7edf5", cursor: "#7da6ff" },
			});
			fitAddon = new ghostty.FitAddon();
			terminal.loadAddon(fitAddon);
			terminal.open(container.current);
			fitAddon.observeResize();
			fitAddon.fit();
			socket = new WebSocket(socketUrl, [protocol, `${TERMINAL_TICKET_PREFIX}${ticket}`]);
			socket.binaryType = "arraybuffer";
			socket.onopen = () => {
				setStatus("Connected");
				if (terminal)
					socket?.send(
						JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }),
					);
			};
			socket.onmessage = (event) => {
				if (event.data instanceof ArrayBuffer) terminal?.write(new Uint8Array(event.data));
				else if (typeof event.data === "string") {
					try {
						const control = JSON.parse(event.data) as { type?: string; message?: string };
						if (control.type === "error") setStatus(control.message ?? "Terminal error");
					} catch {
						terminal?.write(event.data);
					}
				}
			};
			socket.onclose = (event) => {
				if (disposed) return;
				const message = event.reason || "Terminal disconnected";
				setStatus(message);
				void onDisconnected(message);
			};
			terminal.onData((data) => {
				if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
			});
			terminal.onResize(({ cols, rows }) => {
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
			fitAddon?.dispose();
			terminal?.dispose();
		};
	}, [fontSize, onDisconnected, protocol, socketUrl, ticket]);
	return (
		<main style={{ background: "#0b0d10", color: "#e7edf5", height: "100vh" }}>
			<div aria-live="polite" style={{ color: "#8d99a8", font: "12px system-ui", padding: 6 }}>
				{status}
			</div>
			<div ref={container} style={{ height: "calc(100vh - 30px)", width: "100%" }} />
		</main>
	);
}
