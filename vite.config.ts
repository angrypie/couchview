import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { uniwind } from "uniwind/vite";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function externalizeGhosttyWasm() {
	return {
		name: "externalize-ghostty-wasm",
		enforce: "pre" as const,
		transform(code: string, id: string) {
			if (!id.endsWith("/ghostty-web/dist/ghostty-web.js")) return null;
			const embeddedWasm =
				/new URL\(["`]data:application\/wasm;base64,[A-Za-z0-9+/=]+["`], self\.location\)/;
			if (!embeddedWasm.test(code)) {
				throw new Error(
					"ghostty-web's embedded WASM shape changed; update the externalization transform",
				);
			}
			return code.replace(embeddedWasm, 'new URL("about:blank")');
		},
	};
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const apiOrigin =
		process.env.COUCHVIEW_API_ORIGIN || env.COUCHVIEW_API_ORIGIN || "http://127.0.0.1:3001";
	const webHost = process.env.COUCHVIEW_WEB_HOST || env.COUCHVIEW_WEB_HOST || "127.0.0.1";
	const webPort = Number(process.env.COUCHVIEW_WEB_PORT || env.COUCHVIEW_WEB_PORT || 5173);

	return {
		plugins: [
			externalizeGhosttyWasm(),
			tailwindcss(),
			uniwind({
				cssEntryFile: "./global.css",
				dtsFile: "./.uniwind-types.generated.d.ts",
			}),
			react(),
			VitePWA({
				registerType: "prompt",
				// The platform-neutral client registration owns safe activation timing.
				injectRegister: null,
				// Manifest icons remain network-loaded metadata assets. The offline
				// review shell does not need to retain duplicate, unhashed copies.
				includeManifestIcons: false,
				manifest: {
					id: "/",
					name: "Couchview",
					short_name: "Couchview",
					description: "Review, comment on, and stage local Git changes from any screen.",
					start_url: "/",
					scope: "/",
					display: "standalone",
					orientation: "any",
					background_color: "#0b0d10",
					theme_color: "#101317",
					categories: ["developer", "productivity", "utilities"],
					icons: [
						{
							src: "/icon.svg",
							sizes: "any",
							type: "image/svg+xml",
							purpose: "any",
						},
						{
							src: "/pwa-192x192.png",
							sizes: "192x192",
							type: "image/png",
							purpose: "any",
						},
						{
							src: "/pwa-512x512.png",
							sizes: "512x512",
							type: "image/png",
							purpose: "any",
						},
						{
							src: "/maskable-512x512.png",
							sizes: "512x512",
							type: "image/png",
							purpose: "maskable",
						},
					],
				},
				workbox: {
					cleanupOutdatedCaches: true,
					clientsClaim: false,
					skipWaiting: false,
					// Keep the core bundle and the most common Couchview languages warm
					// without downloading Pierre's complete grammar and
					// theme catalog on every service-worker update. Document navigations
					// stay on the network so Cloudflare Access can handle sign-in.
					globPatterns: [
						"assets/index-*.{js,css}",
						"assets/{javascript,typescript,jsx,tsx,json,css,html,markdown}-*.js",
					],
					// vite-plugin-pwa defaults this to index.html. Disable it explicitly:
					// an offline app shell can hide an expired Cloudflare Access session.
					navigateFallback: null,
					runtimeCaching: [
						{
							// Git state is live and repository-specific: never serve API data
							// from a service-worker cache, including while offline.
							urlPattern: ({ url }) => /^\/api(?:\/|$)/.test(url.pathname),
							handler: "NetworkOnly",
							method: "GET",
						},
					],
				},
				integration: {
					// vite-plugin-pwa always adds the generated web manifest as an
					// additional Workbox entry. Remove that unhashed entry so the
					// precache contract stays limited to the selected shell assets.
					beforeBuildServiceWorker(options) {
						options.workbox.additionalManifestEntries =
							options.workbox.additionalManifestEntries?.filter((entry) =>
								typeof entry === "string"
									? entry !== options.manifestFilename
									: entry.url !== options.manifestFilename,
							);
					},
				},
				devOptions: {
					enabled: false,
				},
			}),
		],
		// Keep production assets external so a strict `default-src 'self'` CSP can
		// be used without allowing data: asset URLs.
		build: {
			assetsInlineLimit: 0,
		},
		worker: {
			format: "es",
		},
		server: {
			host: webHost,
			port: webPort,
			strictPort: true,
			proxy: {
				"/api": {
					target: apiOrigin,
					changeOrigin: false,
					ws: true,
				},
			},
		},
	};
});
