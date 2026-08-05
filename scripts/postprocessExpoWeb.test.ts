import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expoWebManifest, extractInlineBootstrapScripts } from "./postprocessExpoWeb.ts";

test("extracts executable Expo bootstrap scripts into hashed local assets", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-expo-html-"));
	try {
		const html = await extractInlineBootstrapScripts(
			'<head><script type="module">globalThis.__expo = true;</script>' +
				'<script type="application/json">{"route":"/"}</script></head>',
			directory,
		);
		expect(html).toMatch(/<script type="module" src="\/_expo\/static\/js\/web\/bootstrap-/);
		expect(html).toContain('<script type="application/json">{"route":"/"}</script>');
		const asset = /src="\/([^"]+bootstrap-[^"]+\.js)"/.exec(html)?.[1];
		expect(asset).toBeTruthy();
		expect(await readFile(path.join(directory, asset!), "utf8")).toBe("globalThis.__expo = true;");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("keeps the install manifest scoped to the network-served application", () => {
	expect(expoWebManifest).toMatchObject({
		display: "standalone",
		scope: "/",
		start_url: "/",
	});
	expect(expoWebManifest.icons.some(({ purpose }) => purpose === "maskable")).toBe(true);
});
