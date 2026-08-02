import { type RTCDataChannel, RTCPeerConnection } from "werift";

import {
	TERMINAL_ENDED_CLOSE_CODE,
	TERMINAL_P2P_FAILED_CLOSE_CODE,
	type TerminalAttachmentRequest,
} from "../src/shared/contracts.ts";
import { fixtureJson } from "./e2eFixtureHttp.ts";

export interface FixtureTerminalSocketData {
	repositoryId: string;
	clientId: string;
	cols: number;
	rows: number;
}

interface FixtureP2pState {
	peer: RTCPeerConnection;
	channel: RTCDataChannel | null;
	socket: Bun.ServerWebSocket<FixtureTerminalSocketData>;
	active: boolean;
}

export class FixtureTerminal {
	readonly websocket: Bun.WebSocketHandler<FixtureTerminalSocketData>;

	private running = false;
	private attachmentCount = 0;
	private socketConnections = 0;
	private ticketCounter = 0;
	private p2pConnections = 0;
	private readonly inputs: string[] = [];
	private readonly resizes: Array<{ cols: number; rows: number }> = [];
	private readonly tickets = new Map<string, FixtureTerminalSocketData>();
	private controller: Bun.ServerWebSocket<FixtureTerminalSocketData> | null = null;
	private p2p: FixtureP2pState | null = null;

	constructor() {
		this.websocket = {
			open: (socket) => this.open(socket),
			message: (socket, message) => this.message(socket, message),
			close: (socket) => this.closeSocket(socket),
		};
	}

	private closeP2p(): void {
		const state = this.p2p;
		this.p2p = null;
		if (!state) return;
		try {
			state.channel?.close();
		} catch {
			// The deterministic peer may already have closed its SCTP association.
		}
		void state.peer.close().catch(() => undefined);
	}

	private handleControl(
		control: { type?: string; id?: number; cols?: number; rows?: number },
		send: (value: string) => void,
	): void {
		if (control.type === "ping" && Number.isSafeInteger(control.id)) {
			send(JSON.stringify({ type: "pong", id: control.id }));
			return;
		}
		if (
			control.type === "resize" &&
			Number.isSafeInteger(control.cols) &&
			Number.isSafeInteger(control.rows)
		) {
			this.resizes.push({ cols: control.cols!, rows: control.rows! });
		}
	}

	private async negotiate(
		socket: Bun.ServerWebSocket<FixtureTerminalSocketData>,
		offer: { type: "offer"; sdp: string },
	): Promise<void> {
		this.closeP2p();
		const peer = new RTCPeerConnection({ iceServers: [] });
		const state: FixtureP2pState = { peer, channel: null, socket, active: false };
		this.p2p = state;
		this.p2pConnections += 1;
		peer.onDataChannel.subscribe((channel) => {
			if (
				this.p2p !== state ||
				channel.label !== "couchview-terminal" ||
				channel.protocol !== "couchview-terminal-data-v1" ||
				!channel.ordered
			) {
				channel.close();
				return;
			}
			state.channel = channel;
			channel.onMessage.subscribe((message) => {
				if (this.p2p !== state || !state.active) return;
				if (typeof message === "string") {
					try {
						this.handleControl(JSON.parse(message), (value) => channel.send(value));
					} catch {
						// The deterministic fixture ignores malformed control frames.
					}
					return;
				}
				this.inputs.push(new TextDecoder().decode(message));
				channel.send(message);
			});
			const switchTransport = () => {
				if (this.p2p === state && !state.active) {
					socket.send(JSON.stringify({ type: "webrtc-switch" }));
				}
			};
			channel.stateChanged.subscribe((channelState) => {
				if (channelState === "open") switchTransport();
			});
			if (channel.readyState === "open") switchTransport();
		});
		try {
			await peer.setRemoteDescription(offer);
			const answer = await peer.createAnswer();
			await peer.setLocalDescription(answer);
			if (this.p2p !== state || !peer.localDescription) return;
			socket.send(JSON.stringify({ type: "webrtc-answer", answer: peer.localDescription }));
		} catch {
			if (this.p2p === state) {
				this.closeP2p();
				socket.send(
					JSON.stringify({
						type: "webrtc-unavailable",
						message: "The deterministic direct path could not connect.",
					}),
				);
			}
		}
	}

	private open(socket: Bun.ServerWebSocket<FixtureTerminalSocketData>): void {
		if (this.controller && this.controller !== socket) {
			this.closeP2p();
			this.controller.close(4001, "taken_over");
		}
		this.controller = socket;
		this.running = true;
		this.socketConnections += 1;
		socket.send(
			JSON.stringify({
				type: "ready",
				profileId: "tmux",
				cols: socket.data.cols,
				rows: socket.data.rows,
			}),
		);
		socket.send(
			new TextEncoder().encode(
				"\u001b[2J\u001b[H\r\n\u001b[1;32m Couchview fake tmux ready\u001b[0m\r\n",
			),
		);
	}

	private message(
		socket: Bun.ServerWebSocket<FixtureTerminalSocketData>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		if (typeof message === "string") {
			try {
				const control = JSON.parse(message) as {
					type?: string;
					id?: number;
					cols?: number;
					rows?: number;
					offer?: { type: "offer"; sdp: string };
				};
				if (control.type === "webrtc-offer" && control.offer) {
					void this.negotiate(socket, control.offer);
					return;
				}
				if (control.type === "webrtc-activate") {
					const state = this.p2p;
					if (state?.socket === socket && state.channel?.readyState === "open") {
						state.active = true;
						state.channel.send(
							JSON.stringify({
								type: "ready",
								transport: "webrtc",
								leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
							}),
						);
					}
					return;
				}
				if (!this.p2p?.active) {
					this.handleControl(control, (value) => socket.send(value));
				}
			} catch {
				// The deterministic fixture ignores malformed control frames.
			}
			return;
		}
		if (!this.p2p?.active) {
			this.inputs.push(new TextDecoder().decode(message));
			socket.send(message);
		}
	}

	private closeSocket(socket: Bun.ServerWebSocket<FixtureTerminalSocketData>): void {
		if (this.controller === socket) {
			this.controller = null;
			this.closeP2p();
		}
	}

	consumeUpgrade(
		request: Request,
		server: Bun.Server<FixtureTerminalSocketData>,
		repositoryId: string | null,
		repositoryExists: boolean,
	): Response | undefined {
		const protocols = (request.headers.get("sec-websocket-protocol") || "")
			.split(",")
			.map((value) => value.trim());
		const ticketProtocol = protocols.find((value) => value.startsWith("couchview-ticket."));
		const ticket = ticketProtocol?.slice("couchview-ticket.".length) || "";
		const data = this.tickets.get(ticket);
		if (ticket) this.tickets.delete(ticket);
		if (
			!repositoryExists ||
			!protocols.includes("couchview-terminal-v1") ||
			!data ||
			data.repositoryId !== repositoryId ||
			!request.headers.get("origin")
		) {
			return fixtureJson(
				{
					error: {
						code: "terminal_ticket_invalid",
						message: "Invalid fixture ticket",
					},
				},
				403,
			);
		}
		return server.upgrade(request, {
			data,
			headers: { "Sec-WebSocket-Protocol": "couchview-terminal-v1" },
		})
			? undefined
			: fixtureJson(
					{
						error: {
							code: "websocket_upgrade_failed",
							message: "Fixture upgrade failed",
						},
					},
					400,
				);
	}

	diagnostics() {
		return {
			running: this.running,
			attachmentCount: this.attachmentCount,
			socketConnections: this.socketConnections,
			inputs: this.inputs,
			resizes: this.resizes,
			p2pActive: this.p2p?.active ?? false,
			p2pConnections: this.p2pConnections,
		};
	}

	status() {
		return {
			profileId: "tmux" as const,
			running: this.running,
			controllerConnected: this.controller !== null,
		};
	}

	issueAttachment(repositoryId: string, body: TerminalAttachmentRequest): Response {
		if (
			body.profileId !== "tmux" ||
			typeof body.clientId !== "string" ||
			!Number.isSafeInteger(body.cols) ||
			!Number.isSafeInteger(body.rows)
		) {
			return fixtureJson(
				{
					error: {
						code: "terminal_attachment_invalid",
						message: "Invalid fixture attachment",
					},
				},
				400,
			);
		}
		this.running = true;
		this.attachmentCount += 1;
		this.resizes.push({ cols: body.cols, rows: body.rows });
		const ticket = `fixture-ticket-${++this.ticketCounter}`;
		this.tickets.set(ticket, {
			repositoryId,
			clientId: body.clientId,
			cols: body.cols,
			rows: body.rows,
		});
		return fixtureJson(
			{
				ticket,
				expiresAt: new Date(Date.now() + 30_000).toISOString(),
				protocol: "couchview-terminal-v1",
				session: this.status(),
				webRtc: {
					iceServers: [],
					negotiationTimeoutMs: 10_000,
					leaseRenewIntervalMs: 30_000,
				},
			},
			201,
		);
	}

	renewLease(): Response {
		return this.p2p?.active
			? fixtureJson({ expiresAt: new Date(Date.now() + 120_000).toISOString() })
			: fixtureJson(
					{
						error: {
							code: "terminal_p2p_inactive",
							message: "No direct fixture terminal is active",
						},
					},
					409,
				);
	}

	end(): Response {
		this.running = false;
		this.tickets.clear();
		this.closeP2p();
		this.controller?.close(TERMINAL_ENDED_CLOSE_CODE, "terminal_ended");
		this.controller = null;
		return fixtureJson({ status: "ended" });
	}

	failP2p(): Response {
		const controller = this.controller;
		this.closeP2p();
		controller?.close(TERMINAL_P2P_FAILED_CLOSE_CODE, "terminal_p2p_fixture_failed");
		return fixtureJson({ failed: true });
	}

	reset(): void {
		this.closeP2p();
		this.controller?.close(1000, "fixture_reset");
		this.controller = null;
		this.running = false;
		this.attachmentCount = 0;
		this.socketConnections = 0;
		this.ticketCounter = 0;
		this.p2pConnections = 0;
		this.inputs.splice(0);
		this.resizes.splice(0);
		this.tickets.clear();
	}
}
