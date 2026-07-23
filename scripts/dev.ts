import { realpath, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { accessOriginsForHost, normalizeBindHost } from "../src/server/server.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rawArgs = Bun.argv.slice(2).filter((arg) => arg !== "--");

function readArguments(args: string[]): { root: string; host: string } {
  let root =
    process.env.COUCHVIEW_ROOT ||
    process.env.COUCH_REVIEW_ROOT ||
    process.cwd();
  let host =
    process.env.COUCHVIEW_HOST ||
    process.env.COUCH_REVIEW_HOST ||
    "0.0.0.0";
  let explicitRoot = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--repo" || argument === "--root") {
      const value = args[index + 1];
      if (!value || value.startsWith("--") || explicitRoot) {
        console.error("A repository path must be provided exactly once.");
        process.exit(2);
      }
      root = value;
      explicitRoot = true;
      index += 1;
    } else if (argument === "--host") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        console.error("--host requires an IP address or hostname.");
        process.exit(2);
      }
      host = value;
      index += 1;
    } else if (argument && !argument.startsWith("-") && !explicitRoot) {
      root = argument;
      explicitRoot = true;
    } else {
      console.error("Usage: bun run dev -- [--repo <path>] [--host <address>]");
      process.exit(2);
    }
  }
  return { root, host: normalizeBindHost(host) };
}

const devOptions = readArguments(rawArgs);
const requestedRoot = resolve(devOptions.root);
const rootStats = await stat(requestedRoot).catch(() => null);

if (!rootStats?.isDirectory()) {
  console.error(`Review root is not a directory: ${requestedRoot}`);
  process.exit(2);
}

const reviewRoot = await realpath(requestedRoot);
const apiHost = devOptions.host;
const apiPort = Number(process.env.PORT || 3001);
const webHost = normalizeBindHost(
  process.env.COUCHVIEW_WEB_HOST ||
  process.env.COUCH_REVIEW_WEB_HOST ||
  apiHost,
);
const webPort = Number(
  process.env.COUCHVIEW_WEB_PORT ||
  process.env.COUCH_REVIEW_WEB_PORT ||
  5173,
);

for (const [name, port] of [
  ["PORT", apiPort],
  ["COUCHVIEW_WEB_PORT", webPort],
] as const) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    console.error(`${name} must be an integer from 1 to 65535.`);
    process.exit(2);
  }
}

const proxyHost = apiHost === "0.0.0.0"
  ? "127.0.0.1"
  : apiHost === "::"
    ? "[::1]"
    : isIP(apiHost) === 6
      ? `[${apiHost}]`
      : apiHost;
const apiOrigin = `http://${proxyHost}:${apiPort}`;
const frontendOrigins = accessOriginsForHost(webHost, webPort);
const allowedOrigins = frontendOrigins
  .map((origin) => origin.trim())
  .filter(Boolean)
  .filter((origin, index, values) => values.indexOf(origin) === index)
  .join(",");

const sharedEnv = {
  ...process.env,
  NODE_ENV: "development",
  COUCHVIEW_ROOT: reviewRoot,
  COUCHVIEW_HOST: apiHost,
  PORT: String(apiPort),
  ALLOWED_ORIGINS: allowedOrigins,
  COUCHVIEW_API_ORIGIN: apiOrigin,
  COUCHVIEW_WEB_HOST: webHost,
  COUCHVIEW_WEB_PORT: String(webPort),
  COUCHVIEW_DISABLE_REUSE: "1",
};

console.log(`Reviewing ${reviewRoot}`);
console.log(frontendOrigins.length === 1 ? "Frontend URL:" : "Frontend URLs:");
for (const origin of frontendOrigins) {
  if (!origin.includes("//0.0.0.0:") && !origin.includes("//[::]:")) console.log(`  ${origin}`);
}
console.log(`API proxy: ${apiOrigin}`);

const backend = Bun.spawn([process.execPath, "run", "src/server/cli.ts"], {
  cwd: appRoot,
  env: sharedEnv,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const frontend = Bun.spawn(
  [
    process.execPath,
    "x",
    "vite",
    "--host",
    webHost,
    "--port",
    String(webPort),
    "--strictPort",
  ],
  {
    cwd: appRoot,
    env: sharedEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

const children = [backend, frontend];
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill(signal);
    } catch {
      // A child may already have exited.
    }
  }
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

const firstExit = await Promise.race(
  children.map(async (child, index) => ({ index, code: await child.exited })),
);

shutdown();
await Promise.allSettled(children.map((child) => child.exited));

if (!shuttingDown || firstExit.code !== 0) {
  const service = firstExit.index === 0 ? "API" : "frontend";
  console.error(`${service} process exited with code ${firstExit.code}.`);
}

process.exitCode = firstExit.code;
