import { describe, expect, test } from "bun:test";

import type { NeedleResolver } from "./needleRuntime.ts";
import { VoiceCommandService } from "./VoiceCommandService.ts";

async function waitForInitialization(service: VoiceCommandService): Promise<void> {
	for (let attempt = 0; attempt < 20 && service.capability.state === "installing"; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

describe("VoiceCommandService", () => {
	test("keeps the host usable when the flag is absent", async () => {
		const service = new VoiceCommandService({ enabled: false, storageDirectory: "/unused" });
		expect(service.capability).toMatchObject({
			enabled: false,
			ready: false,
			state: "disabled",
			canRetry: false,
		});
		await expect(service.resolve("open settings")).rejects.toMatchObject({
			code: "voice_commands_unavailable",
		});
		await expect(service.retry()).rejects.toMatchObject({ code: "voice_commands_disabled" });
		service.close();
	});

	test("returns an array contract from the local resolver", async () => {
		let closed = false;
		const resolver: NeedleResolver = {
			resolve: async () => ({
				actionIds: ["navigate.artifacts", "file.markReviewed"],
				confidence: 0.94,
				reasoning: "'artifacts' -> open_artifacts; 'review' -> mark_current_file_reviewed",
			}),
			close: () => {
				closed = true;
			},
		};
		const service = new VoiceCommandService({
			enabled: true,
			storageDirectory: "/unused",
			ensureLibrary: async () => "/fake/libneedle.dylib",
			createResolver: async () => resolver,
		});
		await waitForInitialization(service);
		expect(service.capability).toMatchObject({ ready: true, state: "ready" });
		const response = await service.resolve("open artifacts and review this file");
		expect(response.commands.map((command) => command.actionId)).toEqual([
			"navigate.artifacts",
			"file.markReviewed",
		]);
		expect(response.confidence).toBe(0.94);
		expect(response.reasoning).toBe(
			"'artifacts' -> open_artifacts; 'review' -> mark_current_file_reviewed",
		);
		service.close();
		expect(closed).toBe(true);
	});

	test("uses Needle as the only interpreter even for a canonical phrase", async () => {
		const service = new VoiceCommandService({
			enabled: true,
			storageDirectory: "/unused",
			ensureLibrary: async () => "/fake/libneedle.dylib",
			createResolver: () => ({
				resolve: async () => ({
					actionIds: ["file.unstage"],
					confidence: 0.02,
					reasoning: "Needle chose unstage",
				}),
				close: () => undefined,
			}),
		});
		await waitForInitialization(service);
		const response = await service.resolve("review this file");
		expect(response).toMatchObject({
			confidence: 0.02,
			reasoning: "Needle chose unstage",
			commands: [{ actionId: "file.unstage" }],
		});
		service.close();
	});

	test("exposes a retryable failure without throwing from startup", async () => {
		let attempts = 0;
		const service = new VoiceCommandService({
			enabled: true,
			storageDirectory: "/unused",
			ensureLibrary: async () => {
				attempts += 1;
				if (attempts === 1) throw new Error("runtime download failed");
				return "/fake/libneedle.dylib";
			},
			createResolver: () => ({
				resolve: async () => ({ actionIds: [], confidence: 0.2, reasoning: null }),
				close: () => undefined,
			}),
		});
		await waitForInitialization(service);
		expect(service.capability).toMatchObject({ state: "failed", canRetry: true });
		await service.retry();
		expect(service.capability).toMatchObject({ state: "ready", canRetry: false });
		service.close();
	});

	test("closes a worker resolver that finishes initializing after service shutdown", async () => {
		const creation: { finish: ((resolver: NeedleResolver) => void) | null } = { finish: null };
		let resolverClosed = false;
		const service = new VoiceCommandService({
			enabled: true,
			storageDirectory: "/unused",
			ensureLibrary: async () => "/fake/libneedle.dylib",
			createResolver: () =>
				new Promise<NeedleResolver>((resolve) => {
					creation.finish = resolve;
				}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		service.close();
		if (!creation.finish) throw new Error("resolver creation did not start");
		creation.finish({
			resolve: async () => ({ actionIds: [], confidence: 0, reasoning: null }),
			close: () => {
				resolverClosed = true;
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(resolverClosed).toBe(true);
		expect(service.capability.ready).toBe(false);
	});
});
