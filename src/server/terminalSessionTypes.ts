export interface TerminalSocketData {
	kind: "terminal";
	repositoryId: string;
	repositoryRoot: string;
	clientId: string;
	profileId: "tmux";
	cols: number;
	rows: number;
	takeover: boolean;
	host: string;
	origin: string | null;
	nativeClientId?: string | null;
}

export type TerminalRequestBinding =
	| { host: string; origin: string; nativeClientId?: never }
	| { host: string; nativeClientId: string; origin?: never };

export interface TerminalDependencies {
	terminalAvailable: boolean;
	tmuxPath: string | null;
	tmux256Color: boolean;
}

export interface TerminalCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export type TerminalCommandRunner = (
	argv: readonly string[],
	options?: { cwd?: string; timeoutMs?: number },
) => Promise<TerminalCommandResult>;

export interface TerminalEvent<T extends unknown[]> {
	subscribe(handler: (...args: T) => void): { unSubscribe(): void };
}

export interface TerminalDataChannel {
	readonly label: string;
	readonly protocol: string;
	readonly ordered: boolean;
	readonly maxRetransmits?: number | null;
	readonly maxPacketLifeTime?: number | null;
	readonly readyState: "open" | "closed" | "connecting" | "closing";
	readonly bufferedAmount: number;
	readonly stateChanged: TerminalEvent<["open" | "closed" | "connecting" | "closing"]>;
	readonly onMessage: TerminalEvent<[string | Buffer<ArrayBufferLike>]>;
	readonly error: TerminalEvent<[Error]>;
	send(data: Buffer<ArrayBufferLike> | string): void;
	close(): void;
}

export interface TerminalPeerConnection {
	readonly onDataChannel: TerminalEvent<[TerminalDataChannel]>;
	readonly connectionStateChange: TerminalEvent<
		["disconnected" | "closed" | "new" | "connected" | "connecting" | "failed"]
	>;
	readonly localDescription?: { type: "offer" | "answer"; sdp: string };
	setRemoteDescription(description: { type: "offer"; sdp: string }): Promise<void>;
	createAnswer(): Promise<{ type: "answer"; sdp: string }>;
	setLocalDescription(description: { type: "answer"; sdp: string }): Promise<unknown>;
	close(): Promise<void>;
}

export interface TerminalSessionServiceOptions {
	enabled: boolean;
	disabledReason?: string;
	namespaceSeed: string;
	dependencies?: TerminalDependencies;
	commandRunner?: TerminalCommandRunner;
	now?: () => number;
	tokenFactory?: () => string;
	runtimeDirectory?: string;
	userTmuxConfigPath?: string | null;
	terminalFactory?: (options: Bun.TerminalOptions) => Bun.Terminal;
	terminalSpawner?: (
		argv: readonly string[],
		options: {
			cwd: string;
			env: Record<string, string | undefined>;
			terminal: Bun.Terminal;
		},
	) => ReturnType<typeof Bun.spawn>;
	p2pEnabled?: boolean;
	stunUrls?: readonly string[];
	peerConnectionFactory?: (iceServers: readonly string[]) => TerminalPeerConnection;
	setTimer?: typeof setTimeout;
	clearTimer?: typeof clearTimeout;
}

export interface TerminalWebRtcState {
	peer: TerminalPeerConnection;
	channel: TerminalDataChannel | null;
	negotiationTimer: ReturnType<typeof setTimeout> | null;
	outputBuffer: Buffer<ArrayBuffer>[];
	outputBufferBytes: number;
}

export interface TerminalAttachment {
	socket: Bun.ServerWebSocket<TerminalSocketData>;
	terminal: Bun.Terminal;
	process: ReturnType<typeof Bun.spawn>;
	clientId: string;
	host: string;
	origin: string | null;
	nativeClientId: string | null;
	transport: "websocket" | "switching" | "webrtc";
	webRtc: TerminalWebRtcState | null;
	leaseExpiresAt: number | null;
	leaseTimer: ReturnType<typeof setTimeout> | null;
}
