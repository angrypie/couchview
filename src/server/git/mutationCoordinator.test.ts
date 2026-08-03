import { describe, expect, test } from "bun:test";

import { RepositoryMutationCoordinator } from "./mutationCoordinator.ts";

describe("RepositoryMutationCoordinator", () => {
	test("runs repository mutations in request order", async () => {
		const coordinator = new RepositoryMutationCoordinator();
		const events: string[] = [];
		let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const first = coordinator.run(async () => {
			events.push("first started");
			await firstGate;
			events.push("first finished");
		});
		const second = coordinator.run(async () => {
			events.push("second started");
			events.push("second finished");
		});

		await Promise.resolve();
		expect(events).toEqual(["first started"]);
		releaseFirst();
		await Promise.all([first, second]);
		expect(events).toEqual([
			"first started",
			"first finished",
			"second started",
			"second finished",
		]);
	});
});
