import path from "node:path";

import type {
	ResolveVoiceCommandsResponse,
	VoiceCommandCapability,
} from "../../shared/contracts.ts";
import { VOICE_COMMAND_MODEL } from "../../shared/voiceCommands.ts";
import { HttpError } from "../errors.ts";
import { ensureNeedleLibrary, type NeedleResolver } from "./needleRuntime.ts";
import { openNeedleResolver } from "./needleWorkerClient.ts";

export interface VoiceCommandServiceOptions {
	enabled: boolean;
	storageDirectory: string;
	createResolver?(libraryPath: string): NeedleResolver | Promise<NeedleResolver>;
	ensureLibrary?(storageDirectory: string): Promise<string>;
}

export class VoiceCommandService {
	private state: VoiceCommandCapability["state"];
	private reason: string | null;
	private resolver: NeedleResolver | null = null;
	private initialization: Promise<void> | null = null;
	private inferenceQueue = Promise.resolve();
	private closed = false;

	constructor(private readonly options: VoiceCommandServiceOptions) {
		this.state = options.enabled ? "installing" : "disabled";
		this.reason = options.enabled
			? "Needle 2 is being installed on the Couchview host."
			: "Start Couchview with --enable-voice-commands to allow voice commands.";
		if (options.enabled) void this.initialize();
	}

	get enabled(): boolean {
		return this.options.enabled;
	}

	get capability(): VoiceCommandCapability {
		return {
			enabled: this.options.enabled,
			ready: this.state === "ready",
			state: this.state,
			model: VOICE_COMMAND_MODEL,
			reason: this.reason,
			requiredFlags: ["--enable-speech", "--enable-voice-commands"],
			canRetry: this.options.enabled && this.state === "failed",
		};
	}

	async retry(): Promise<VoiceCommandCapability> {
		if (!this.options.enabled) {
			throw new HttpError(
				409,
				"voice_commands_disabled",
				"Restart Couchview with --enable-voice-commands before enabling this profile setting.",
			);
		}
		if (this.state === "ready") return this.capability;
		await this.initialize();
		return this.capability;
	}

	async resolve(transcript: unknown): Promise<ResolveVoiceCommandsResponse> {
		if (
			typeof transcript !== "string" ||
			transcript.trim().length < 1 ||
			transcript.length > 2_000
		) {
			throw new HttpError(400, "voice_transcript_invalid", "Voice transcript is invalid.");
		}
		if (this.state !== "ready" || !this.resolver) {
			throw new HttpError(
				409,
				"voice_commands_unavailable",
				this.reason ?? "Voice commands are unavailable.",
			);
		}
		const resolver = this.resolver;
		let release: () => void = () => undefined;
		const previous = this.inferenceQueue;
		this.inferenceQueue = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		const startedAt = performance.now();
		try {
			const result = await resolver.resolve(transcript.trim());
			const commands = result.actionIds.map((actionId) => ({ actionId }));
			const inferenceMs = Math.round(performance.now() - startedAt);
			const bucket =
				result.confidence >= 0.9 ? "high" : result.confidence >= 0.5 ? "medium" : "low";
			console.info(
				`Voice command inference: model=${VOICE_COMMAND_MODEL} durationMs=${inferenceMs} ` +
					`confidence=${bucket} results=${commands.length}`,
			);
			return {
				commands,
				confidence: result.confidence,
				reasoning: result.reasoning,
				inferenceMs,
				model: VOICE_COMMAND_MODEL,
			};
		} catch (error) {
			console.warn(
				`Voice command inference failed: model=${VOICE_COMMAND_MODEL} ` +
					`durationMs=${Math.round(performance.now() - startedAt)}`,
			);
			throw new HttpError(
				500,
				"voice_command_failed",
				error instanceof Error ? error.message : "Needle could not resolve the command.",
			);
		} finally {
			release();
		}
	}

	close(): void {
		this.closed = true;
		this.resolver?.close();
		this.resolver = null;
	}

	private async initialize(): Promise<void> {
		if (this.closed) return;
		if (this.initialization) return this.initialization;
		this.resolver?.close();
		this.resolver = null;
		this.state = "installing";
		this.reason = "Needle 2 is being installed on the Couchview host.";
		const ensureLibrary = this.options.ensureLibrary ?? ensureNeedleLibrary;
		const createResolver = this.options.createResolver ?? openNeedleResolver;
		const initialization = (async () => {
			try {
				const library = await ensureLibrary(path.resolve(this.options.storageDirectory));
				if (this.closed) return;
				const resolver = await createResolver(library);
				if (this.closed) {
					resolver.close();
					return;
				}
				this.resolver = resolver;
				this.state = "ready";
				this.reason = null;
			} catch (error) {
				if (this.closed) return;
				this.state = "failed";
				this.reason = error instanceof Error ? error.message : "Needle 2 could not be installed.";
				console.warn(`Needle 2 unavailable: ${this.reason}`);
			}
		})();
		this.initialization = initialization;
		await initialization;
		if (this.initialization === initialization) this.initialization = null;
	}
}
