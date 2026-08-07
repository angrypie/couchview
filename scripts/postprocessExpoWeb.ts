import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateSW } from "workbox-build";

const EXECUTABLE_SCRIPT_TYPES = new Set([
	"",
	"module",
	"text/javascript",
	"application/javascript",
]);
export const expoWebManifest = {
	id: "/",
	name: "Couchview",
	short_name: "Couchview",
	description: "Review and stage local Git changes from any screen.",
	start_url: "/",
	scope: "/",
	display: "standalone",
	orientation: "any",
	background_color: "#0b0d10",
	theme_color: "#101317",
	categories: ["developer", "productivity", "utilities"],
	icons: [
		{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
		{ src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
		{ src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
		{
			src: "/maskable-512x512.png",
			sizes: "512x512",
			type: "image/png",
			purpose: "maskable",
		},
	],
} as const;

function scriptType(attributes: string): string {
	return /\btype\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]?.toLowerCase() ?? "";
}

export async function extractInlineBootstrapScripts(html: string, outputRoot: string) {
	const pattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
	let processed = "";
	let cursor = 0;
	for (const match of html.matchAll(pattern)) {
		const index = match.index ?? 0;
		const attributes = match[1] ?? "";
		const source = match[2] ?? "";
		processed += html.slice(cursor, index);
		if (
			/\bsrc\s*=/i.test(attributes) ||
			!source.trim() ||
			!EXECUTABLE_SCRIPT_TYPES.has(scriptType(attributes))
		) {
			processed += match[0];
		} else {
			const digest = createHash("sha256").update(source).digest("hex").slice(0, 24);
			const relative = `_expo/static/js/web/bootstrap-${digest}.js`;
			await mkdir(path.join(outputRoot, "_expo/static/js/web"), { recursive: true });
			await writeFile(path.join(outputRoot, relative), source, "utf8");
			processed += `<script${attributes} src="/${relative}"></script>`;
		}
		cursor = index + match[0].length;
	}
	return processed + html.slice(cursor);
}

export function ensureViewportFitCover(html: string): string {
	return html.replace(/<meta\s+name=["']viewport["'][^>]*>/i, (viewport) => {
		if (/viewport-fit\s*=\s*cover/i.test(viewport)) return viewport;
		return viewport.replace(/content=(["'])(.*?)\1/i, (_content, quote, value) => {
			return `content=${quote}${value}, viewport-fit=cover${quote}`;
		});
	});
}

function injectWebMetadata(html: string): string {
	const withViewportFit = ensureViewportFitCover(html);
	if (withViewportFit.includes('rel="manifest"')) return withViewportFit;
	const metadata = `
    <meta name="theme-color" content="#101317" />
    <meta name="description" content="Review local Git changes from a compact installable interface." />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Couchview" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
    <link rel="mask-icon" href="/icon.svg" color="#101317" />
`;
	return withViewportFit.replace("</head>", `${metadata}</head>`);
}

export async function postprocessExpoWeb(outputRoot: string): Promise<void> {
	const indexPath = path.join(outputRoot, "index.html");
	let source = await readFile(indexPath, "utf8");
	const withMetadata = injectWebMetadata(source);
	const html = await extractInlineBootstrapScripts(withMetadata, outputRoot);
	await Promise.all([
		writeFile(indexPath, html, "utf8"),
		writeFile(
			path.join(outputRoot, "manifest.webmanifest"),
			`${JSON.stringify(expoWebManifest, null, 2)}\n`,
			"utf8",
		),
	]);
	const result = await generateSW({
		globDirectory: outputRoot,
		globPatterns: [
			"_expo/static/css/*.css",
			"_expo/static/js/web/{__expo-metro-runtime,__common,entry}-*.js",
		],
		maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
		dontCacheBustURLsMatching: /-[a-f0-9]{16,}\./,
		swDest: path.join(outputRoot, "sw.js"),
		sourcemap: false,
		cleanupOutdatedCaches: true,
		clientsClaim: false,
		skipWaiting: false,
		navigateFallback: undefined,
		runtimeCaching: [
			{
				urlPattern: /\/api(?:\/|$)/,
				handler: "NetworkOnly",
				method: "GET",
			},
			{
				urlPattern: ({ request }) => request.mode === "navigate",
				handler: "NetworkOnly",
			},
		],
	});
	console.log(`Expo PWA post-process: ${result.count} hashed assets, ${result.size} bytes`);
}

if (import.meta.main) {
	await postprocessExpoWeb(path.resolve(process.argv[2] ?? "dist-expo"));
}
