import { describe, expect, test } from "bun:test";

import { clearPwaStorage } from "./offlineApp.ts";

describe("PWA cache recovery", () => {
	test("unregisters the service worker and deletes every origin cache", async () => {
		let unregistered = false;
		const deleted: string[] = [];

		await clearPwaStorage({
			serviceWorker: {
				async getRegistration() {
					return {
						async unregister() {
							unregistered = true;
							return true;
						},
					} as ServiceWorkerRegistration;
				},
			},
			cacheStorage: {
				async keys() {
					return ["workbox-precache", "runtime-assets"];
				},
				async delete(name) {
					deleted.push(name);
					return true;
				},
			},
		});

		expect(unregistered).toBe(true);
		expect(deleted).toEqual(["workbox-precache", "runtime-assets"]);
	});

	test("surfaces cache deletion failures to the recovery screen", async () => {
		await expect(
			clearPwaStorage({
				serviceWorker: null,
				cacheStorage: {
					async keys() {
						throw new Error("cache access denied");
					},
					async delete() {
						return false;
					},
				},
			}),
		).rejects.toThrow("cache access denied");
	});
});
