import {
	AlertTriangle,
	ArrowLeft,
	Bug,
	LoaderCircle,
	RotateCw,
	Search,
	ShieldCheck,
	SquareTerminal,
	Trash2,
} from "lucide-react";
import type { CSSProperties } from "react";

import type { TerminalCapability } from "../../shared/contracts.ts";
import {
	type TerminalWorkspaceControllerOptions,
	useTerminalWorkspace,
} from "../features/terminal/useTerminalWorkspace.ts";
import type { TerminalRendererConfig } from "../typographyPreferences.ts";

export interface TerminalWorkspaceProps extends TerminalWorkspaceControllerOptions {
	commandPaletteShortcut?: string;
	rendererConfig: TerminalRendererConfig;
	repositoryName: string;
	onBack(): void;
	onOpenCommandPalette?(): void;
	capability: TerminalCapability;
}

function transportLabel(
	status: ReturnType<typeof useTerminalWorkspace>["transportStatus"],
): string {
	switch (status) {
		case "finding":
			return "Finding direct path";
		case "direct":
			return "Direct P2P";
		case "fallback":
			return "WebSocket fallback";
		default:
			return "WebSocket";
	}
}

export function TerminalWorkspace({
	commandPaletteShortcut = "",
	onBack,
	onOpenCommandPalette = () => undefined,
	repositoryName,
	...controllerOptions
}: TerminalWorkspaceProps) {
	const {
		activeRendererConfig,
		connectionError,
		connectionLabel,
		connectionState,
		containerRef,
		enableSafeMode,
		endSession,
		ending,
		keyboardHelpersDisabled,
		latencyEnabled,
		latencySummary,
		preserveTerminalFocus,
		retry,
		retryP2p,
		retryP2pAvailable,
		roundTripSummary,
		safeMode,
		sendHelperKey,
		toggleLatencyProfiler,
		toggleVirtualControl,
		transportStatus,
		virtualControlActive,
	} = useTerminalWorkspace(controllerOptions);
	const { active, capability } = controllerOptions;
	return (
		<section
			aria-hidden={!active}
			aria-label="tmux terminal"
			className={`terminal-workspace ${active ? "active" : "hidden"}`}
			inert={!active}
			style={
				{
					"--terminal-background": activeRendererConfig.theme.background,
				} as CSSProperties
			}
		>
			<header className="terminal-toolbar">
				<button className="terminal-toolbar-button" onClick={onBack} type="button">
					<ArrowLeft size={16} /> Review
				</button>
				<div className="terminal-heading">
					<SquareTerminal size={16} />
					<span>{repositoryName}</span>
					<span className={`terminal-connection ${connectionState}`}>{connectionLabel}</span>
					<span
						className={`terminal-transport ${transportStatus}`}
						data-testid="terminal-transport"
					>
						{transportLabel(transportStatus)}
					</span>
				</div>
				<div className="terminal-toolbar-actions">
					<button
						aria-label="Open command palette"
						className="terminal-toolbar-button command-palette-trigger"
						onClick={onOpenCommandPalette}
						type="button"
					>
						<Search size={15} />
						<span className="workspace-command-label">Commands</span>
						{commandPaletteShortcut && (
							<kbd className="workspace-command-shortcut">{commandPaletteShortcut}</kbd>
						)}
					</button>
					{transportStatus === "fallback" && retryP2pAvailable && (
						<button className="terminal-toolbar-button" onClick={retryP2p} type="button">
							<RotateCw size={15} /> Retry P2P
						</button>
					)}
					<button
						aria-pressed={latencyEnabled}
						className={`terminal-toolbar-button${latencyEnabled ? " active" : ""}`}
						onClick={toggleLatencyProfiler}
						type="button"
					>
						<Bug size={15} /> Debug
					</button>
					<button
						className="terminal-toolbar-button danger"
						disabled={ending || connectionState === "ended"}
						onClick={() => void endSession()}
						type="button"
					>
						{ending ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} />}
						End session
					</button>
				</div>
			</header>
			<div className="terminal-stage">
				<div className="terminal-surface" ref={containerRef} />
				<div
					aria-label="Terminal keyboard shortcuts"
					className="terminal-keyboard-bar"
					role="toolbar"
				>
					<button
						aria-label="Control modifier for next key"
						aria-pressed={virtualControlActive}
						className={`terminal-keyboard-key modifier${virtualControlActive ? " active" : ""}`}
						disabled={keyboardHelpersDisabled}
						onClick={toggleVirtualControl}
						onPointerDown={preserveTerminalFocus}
						title="Apply Ctrl to the next keyboard or helper key"
						type="button"
					>
						Ctrl
					</button>
					<button
						aria-label="Send Ctrl+C"
						className="terminal-keyboard-key shortcut"
						disabled={keyboardHelpersDisabled}
						onClick={() => sendHelperKey({ key: "c", code: "KeyC", ctrlKey: true })}
						onPointerDown={preserveTerminalFocus}
						type="button"
					>
						^C
					</button>
					<button
						aria-label="Send Ctrl+L"
						className="terminal-keyboard-key shortcut"
						disabled={keyboardHelpersDisabled}
						onClick={() => sendHelperKey({ key: "l", code: "KeyL", ctrlKey: true })}
						onPointerDown={preserveTerminalFocus}
						type="button"
					>
						^L
					</button>
					<button
						aria-label="Send Escape"
						className="terminal-keyboard-key"
						disabled={keyboardHelpersDisabled}
						onClick={() => sendHelperKey({ key: "Escape", code: "Escape" })}
						onPointerDown={preserveTerminalFocus}
						type="button"
					>
						Esc
					</button>
					<button
						aria-label="Send Tab"
						className="terminal-keyboard-key"
						disabled={keyboardHelpersDisabled}
						onClick={() => sendHelperKey({ key: "Tab", code: "Tab" })}
						onPointerDown={preserveTerminalFocus}
						type="button"
					>
						Tab
					</button>
					<button
						aria-label="Send Arrow Left"
						className="terminal-keyboard-key symbol"
						disabled={keyboardHelpersDisabled}
						onClick={() => sendHelperKey({ key: "ArrowLeft", code: "ArrowLeft" })}
						onPointerDown={preserveTerminalFocus}
						type="button"
					>
						←
					</button>
					<button
						aria-label="Send Arrow Up"
						className="terminal-keyboard-key symbol"
						disabled={keyboardHelpersDisabled}
						onClick={() => sendHelperKey({ key: "ArrowUp", code: "ArrowUp" })}
						onPointerDown={preserveTerminalFocus}
						type="button"
					>
						↑
					</button>
					<button
						aria-label="Send Arrow Down"
						className="terminal-keyboard-key symbol"
						disabled={keyboardHelpersDisabled}
						onClick={() => sendHelperKey({ key: "ArrowDown", code: "ArrowDown" })}
						onPointerDown={preserveTerminalFocus}
						type="button"
					>
						↓
					</button>
					<button
						aria-label="Send Arrow Right"
						className="terminal-keyboard-key symbol"
						disabled={keyboardHelpersDisabled}
						onClick={() => sendHelperKey({ key: "ArrowRight", code: "ArrowRight" })}
						onPointerDown={preserveTerminalFocus}
						type="button"
					>
						→
					</button>
				</div>
				{latencyEnabled && (
					<div
						aria-label="Terminal latency diagnostics"
						className="terminal-latency-overlay"
						data-testid="terminal-latency-overlay"
					>
						<div className="terminal-latency-heading">
							<strong>Terminal latency</strong>
							<span>live</span>
						</div>
						<div className="terminal-latency-grid">
							<div>
								<span>Key → canvas</span>
								<strong>
									{latencySummary ? `${latencySummary.total.lastMs.toFixed(1)} ms` : "Waiting…"}
								</strong>
								<small>
									{latencySummary
										? `p50 ${latencySummary.total.p50Ms.toFixed(1)} · p95 ${latencySummary.total.p95Ms.toFixed(1)} · n=${latencySummary.total.sampleCount}`
										: "Type one clean printable key"}
								</small>
							</div>
							<div>
								<span>Baseline RTT</span>
								<strong>
									{roundTripSummary ? `${roundTripSummary.lastMs.toFixed(1)} ms` : "Measuring…"}
								</strong>
								<small>
									{roundTripSummary
										? `p50 ${roundTripSummary.p50Ms.toFixed(1)} · p95 ${roundTripSummary.p95Ms.toFixed(1)} · n=${roundTripSummary.sampleCount}`
										: "WebSocket ping every 2 seconds"}
								</small>
							</div>
						</div>
						<div className="terminal-latency-phase-heading">
							<strong>Per-key phases</strong>
							<span>latest · p50 · p95</span>
						</div>
						<div className="terminal-latency-phases">
							<div>
								<span>Press → send</span>
								<strong>
									{latencySummary ? `${latencySummary.pressToSend.lastMs.toFixed(1)} ms` : "—"}
								</strong>
								<small>
									{latencySummary
										? `p50 ${latencySummary.pressToSend.p50Ms.toFixed(1)} · p95 ${latencySummary.pressToSend.p95Ms.toFixed(1)}`
										: "Browser input path"}
								</small>
							</div>
							<div>
								<span>Send → receive</span>
								<strong>
									{latencySummary ? `${latencySummary.sendToReceive.lastMs.toFixed(1)} ms` : "—"}
								</strong>
								<small>
									{latencySummary
										? `p50 ${latencySummary.sendToReceive.p50Ms.toFixed(1)} · p95 ${latencySummary.sendToReceive.p95Ms.toFixed(1)}`
										: "Wire + server/tmux echo"}
								</small>
							</div>
							<div>
								<span>Receive → paint</span>
								<strong>
									{latencySummary ? `${latencySummary.receiveToPaint.lastMs.toFixed(1)} ms` : "—"}
								</strong>
								<small>
									{latencySummary
										? `p50 ${latencySummary.receiveToPaint.p50Ms.toFixed(1)} · p95 ${latencySummary.receiveToPaint.p95Ms.toFixed(1)}`
										: "Ghostty parse + canvas frame"}
								</small>
							</div>
						</div>
						<div className="terminal-latency-phase-heading">
							<strong>Receive → paint detail</strong>
							<span>latest · p50 · p95</span>
						</div>
						<div className="terminal-latency-phases terminal-latency-receive-detail">
							<div>
								<span>Receive → write done</span>
								<strong>
									{latencySummary ? `${latencySummary.receiveToWrite.lastMs.toFixed(1)} ms` : "—"}
								</strong>
								<small>
									{latencySummary
										? `p50 ${latencySummary.receiveToWrite.p50Ms.toFixed(1)} · p95 ${latencySummary.receiveToWrite.p95Ms.toFixed(1)}`
										: "Bytes + Ghostty/WASM write"}
								</small>
							</div>
							<div>
								<span>Frame wait</span>
								<strong>
									{latencySummary ? `${latencySummary.writeToRender.lastMs.toFixed(1)} ms` : "—"}
								</strong>
								<small>
									{latencySummary
										? `p50 ${latencySummary.writeToRender.p50Ms.toFixed(1)} · p95 ${latencySummary.writeToRender.p95Ms.toFixed(1)}`
										: "Write done → render starts"}
								</small>
							</div>
							<div>
								<span>Canvas render</span>
								<strong>
									{latencySummary ? `${latencySummary.renderDuration.lastMs.toFixed(1)} ms` : "—"}
								</strong>
								<small>
									{latencySummary
										? `p50 ${latencySummary.renderDuration.p50Ms.toFixed(1)} · p95 ${latencySummary.renderDuration.p95Ms.toFixed(1)}`
										: "CanvasRenderer execution"}
								</small>
							</div>
						</div>
						<div className="terminal-latency-breakdown">
							{latencySummary
								? `Latest key: ${latencySummary.pressToSend.lastMs.toFixed(1)} + ${latencySummary.sendToReceive.lastMs.toFixed(1)} + ${latencySummary.receiveToPaint.lastMs.toFixed(1)} = ${latencySummary.total.lastMs.toFixed(1)} ms.`
								: "The three phases form one accepted key timeline and add to key→canvas."}
						</div>
						<small className="terminal-latency-note">
							Send→receive combines both network legs with server/tmux echo. Baseline RTT is a
							separate immediate WebSocket ping. Receive→paint ends when CanvasRenderer returns,
							before browser compositing or physical display scanout. Frame wait is Ghostty render
							loop scheduling; canvas render is synchronous renderer execution.
						</small>
					</div>
				)}
				{(!capability.available || connectionState !== "connected") && (
					<div className="terminal-overlay" role="status">
						{connectionState === "loading" ||
						connectionState === "connecting" ||
						connectionState === "reconnecting" ? (
							<LoaderCircle className="spinner" size={24} />
						) : (
							<AlertTriangle size={24} />
						)}
						<strong>{connectionLabel}</strong>
						{(connectionError || capability.reason) && (
							<span>{connectionError ?? capability.reason}</span>
						)}
						{["in-use", "taken-over", "ended", "error"].includes(connectionState) &&
							capability.available && (
								<div className="terminal-overlay-actions">
									<button className="action-button secondary" onClick={retry} type="button">
										<RotateCw size={15} />
										{connectionState === "ended" ? "Start tmux" : "Reconnect"}
									</button>
									{connectionState === "error" && !safeMode && (
										<button
											className="action-button secondary"
											onClick={enableSafeMode}
											type="button"
										>
											<ShieldCheck size={15} />
											Safe Mode
										</button>
									)}
								</div>
							)}
					</div>
				)}
			</div>
		</section>
	);
}
