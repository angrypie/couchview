import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const apiPath = /^\/api(?:\/|$)/;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiOrigin =
    process.env.COUCH_REVIEW_API_ORIGIN ||
    env.COUCH_REVIEW_API_ORIGIN ||
    "http://127.0.0.1:3001";
  const webHost =
    process.env.COUCH_REVIEW_WEB_HOST || env.COUCH_REVIEW_WEB_HOST || "127.0.0.1";
  const webPort = Number(
    process.env.COUCH_REVIEW_WEB_PORT || env.COUCH_REVIEW_WEB_PORT || 5173,
  );

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        // The client uses virtual:pwa-register so it can decide when to reload.
        injectRegister: null,
        // Manifest icons remain network-loaded metadata assets. The offline
        // review shell does not need to retain duplicate, unhashed copies.
        includeManifestIcons: false,
        manifest: {
          id: "/",
          name: "Couch Review",
          short_name: "Couch Review",
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
          // Keep only the disconnected shell and Vite's hashed assets offline.
          // Repository/API data and unhashed public icons must never enter the
          // precache.
          globPatterns: ["index.html", "assets/**/*.{js,css,svg,png,woff,woff2}"],
          navigateFallback: "index.html",
          navigateFallbackDenylist: [apiPath],
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
          // precache contract stays limited to index.html + hashed assets.
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
