#!/usr/bin/env bun

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCouchReviewApp, normalizeBindHost } from "./server.ts";

interface CliOptions {
  root: string;
  host: string;
  port: number;
}

export function parseCli(argv: string[]): CliOptions {
  let root = Bun.env.COUCH_REVIEW_ROOT ?? process.cwd();
  let host = Bun.env.COUCH_REVIEW_HOST ?? "127.0.0.1";
  let port = Number(Bun.env.PORT ?? 4173);
  let explicitRoot = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Repository path is required");
      if (explicitRoot) throw new Error("Repository path may only be provided once");
      root = value;
      explicitRoot = true;
      index += 1;
    } else if (argument === "--port") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Port must be between 1 and 65535");
      port = Number(value);
      index += 1;
    } else if (argument === "--host") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Host is required");
      host = value;
      index += 1;
    } else if (argument && !argument.startsWith("-")) {
      if (explicitRoot) throw new Error("Repository path may only be provided once");
      root = argument;
      explicitRoot = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!root) throw new Error("Repository path is required");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Port must be between 1 and 65535");
  }
  return { root: path.resolve(root), host: normalizeBindHost(host), port };
}

export async function startServer(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  const defaultStaticDirectory = fileURLToPath(new URL("../../dist/", import.meta.url));
  const allowedOrigins = (Bun.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (Bun.env.NODE_ENV === "development") {
    allowedOrigins.push("http://127.0.0.1:5173", "http://localhost:5173");
  }
  const app = await createCouchReviewApp({
    root: options.root,
    host: options.host,
    port: options.port,
    staticDirectory: path.resolve(Bun.env.STATIC_DIR ?? defaultStaticDirectory),
    allowedOrigins,
  });
  const server = (() => {
    try {
      return Bun.serve({
        hostname: options.host,
        port: options.port,
        // EventSource connections stay open for the review session. The app
        // emits SSE heartbeats, while this avoids Bun's 10-second default
        // closing the stream before the first heartbeat.
        idleTimeout: 255,
        fetch: app.fetch,
      });
    } catch (error) {
      app.close();
      throw error;
    }
  })();
  const copyableOrigins = app.accessOrigins
    .filter((origin) => !origin.includes("//0.0.0.0:") && !origin.includes("//[::]:"))
    .sort((left, right) => {
      const leftLoopback = /\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|$)/.test(left);
      const rightLoopback = /\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|$)/.test(right);
      return Number(leftLoopback) - Number(rightLoopback) || left.localeCompare(right);
    });
  console.log(copyableOrigins.length === 1 ? "Couch Review URL:" : "Couch Review URLs:");
  for (const origin of copyableOrigins) console.log(`  ${origin}`);
  console.log(`Repository: ${app.repository.root}`);
  if (options.host === "0.0.0.0" || options.host === "::") {
    console.warn("LAN access is enabled. Use a non-loopback URL above on your phone.");
  }

  const stop = () => {
    app.close();
    void server.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return { app, server };
}

if (import.meta.main) {
  startServer().catch((error) => {
    console.error(`Couch Review could not start: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
