# Couch Review

Couch Review is a local-first, mobile-optimized PWA for reviewing the combined `HEAD → working tree` diff of a Git repository. It keeps code nearly full width, makes file and hunk navigation fast, searches a tapped identifier across the project, and collects line comments into a Codex-ready correction prompt.

It shows staged, unstaged, partially staged, and untracked non-ignored changes in one stable queue. Staging a file does not remove it from that queue or mark it reviewed.

## Prerequisite

Couch Review requires Git and Bun 1.3 or newer. On this machine Bun is installed at `/Users/niki/.bun/bin/bun`, but that directory is not on `PATH` by default. Add it before using the package command:

```sh
export PATH="/Users/niki/.bun/bin:$PATH"
bun --version
```

Put the export in the shell profile if it should persist in new terminals.

## Install and run

From this Couch Review checkout, install dependencies, build the production PWA, and link the `couch-review` command:

```sh
bun install
bun run build
bun link
```

Then launch it from any directory inside the Git repository to review:

```sh
cd /absolute/path/to/project
couch-review
```

The repository and port can also be explicit:

```sh
couch-review --repo /absolute/path/to/project --port 4173
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). Couch Review resolves and locks the containing repository root at startup. It binds to `127.0.0.1` by default, so only the same computer can reach it.

### Open it from a phone

Bind to all IPv4 interfaces, then use a printed non-loopback URL on a phone connected to the same network:

```sh
couch-review --host 0.0.0.0 --repo /absolute/path/to/project --port 4173
```

Startup prints every copyable address with LAN URLs first, for example:

```text
Couch Review URLs:
  http://192.168.1.42:4173
  http://127.0.0.1:4173
  http://localhost:4173
```

Copy the `192.168...` address into the phone browser. If it does not connect, confirm both devices are on the same Wi-Fi and allow incoming Bun connections in the computer firewall. The interface list is captured at startup, so restart Couch Review after changing networks. A specific interface address can be used instead of `0.0.0.0`, and `COUCH_REVIEW_HOST` provides the same setting through the environment.

LAN mode exposes repository diffs and staging controls to devices that can reach the computer. Use it only on a trusted network and stop the server when the review is finished. Plain `http://<LAN-IP>` works for reviewing, but mobile browsers do not treat it as a secure context: PWA installation, service workers, and direct clipboard access may be unavailable. Comment copying automatically falls back to selectable text.

To run without linking the command:

```sh
bun run build
bun run start -- --repo /absolute/path/to/project --port 4173
```

For application development, run the Bun API and Vite UI together:

```sh
bun run dev -- --repo /absolute/path/to/project
```

The development UI is at `http://127.0.0.1:5173` and proxies `/api`, including server-sent events, to `http://127.0.0.1:3001`. Pass `--host 0.0.0.0` to expose both development processes and print their phone-accessible URLs. `PORT` can change the development API port and `COUCH_REVIEW_WEB_PORT` can change the Vite port.

## Review workflow

- Open the file drawer to jump directly to a file or filter the queue by All, Unreviewed, Reviewed, or Staged. The persistent arrow controls visit the previous or next file; `[` and `]` do the same from the keyboard.
- Use the hunk up/down controls, or `K` and `J`, to jump between changes in the current file.
- Tap an identifier in a diff to run a literal, case-sensitive project search. Results are separated into Current file and Other files. Opening a result shows a read-only source window with a one-tap return to the active diff.
- Tap a line-number gutter to select a line. Tap another line on the same side and in the same hunk to extend a contiguous range. For a replacement, select both the old and new gutters in that hunk to retain exact old and new ranges in one mixed comment.
- Save any number of independent comments. The comments tray can jump to, edit, or delete them. Copy exports every current, non-stale comment as Markdown with repository-relative paths, exact old/new ranges, excerpts, and correction text. Clipboard denial opens the same text in a selectable dialog; copying never deletes comments.
- Mark reviewed to record the current content revision and automatically advance to the next unreviewed file. Undo is offered. A later content change clears the review and marks existing comment anchors stale.
- Stage writes the whole file to the real Git index. Review and stage are independent actions, and a stale operation is rejected instead of staging changed content.
- Use the visible `A−` and `A+` controls to adjust code from 9–16 px. The compact 11 px default and the selected preference are stored in the browser.

Binary and metadata-only changes remain reviewable and stageable but do not accept line comments. Very large diffs show an explicit truncation warning.

## Install as a PWA

On desktop Chrome or Edge over localhost, use the install icon in the address bar or the in-app install guidance. On iPhone or iPad, PWA installation requires Couch Review to be served through HTTPS; a plain LAN-IP URL can open the review UI but is not a secure context. When HTTPS is available, open Couch Review in Safari, tap **Share**, then **Add to Home Screen**. Launching the installed app uses the standalone, edge-to-edge interface.

The UI shell is available when disconnected, but repository data is intentionally never cached. Diffs, searches, source previews, comments, and all `/api` requests remain network-only, so the offline shell cannot display an old review as current. When a new service worker is ready, Couch Review asks before reloading the active review.

## Local state and security

The server accepts only exact origins derived from the configured bind host and the machine's interfaces at startup, requires a per-launch CSRF header for writes, disables CORS, and serves a restrictive Content Security Policy. It uses argument-array Git processes and validates all repository-relative paths. Loopback remains the default; LAN binding is an explicit trust decision because the tool can read the selected repository and stage files in its index.

Review flags and comments are atomically stored at the Git-private path reported by:

```sh
git rev-parse --git-path couch-review/state.json
```

That metadata does not dirty the working tree. `COUCH_REVIEW_ROOT`, `PORT`, and `STATIC_DIR` provide the corresponding startup defaults when invoking the Bun server directly; command-line `--repo` and `--port` take precedence.

## Test and verification commands

Run the TypeScript checks, Bun unit/integration/UI tests, and production build:

```sh
bun run typecheck
bun test
bun run build
```

Install the browser engines once, then run the mobile production suite:

```sh
bunx playwright install chromium webkit
bun run test:e2e
```

Playwright builds the PWA and starts its deterministic fixture on port 4174. It exercises 320 px, 375 px, and 430 px touch viewports, edge-to-edge horizontal containment, sticky controls, file and hunk navigation, search and source preview, staging, review advancement, mixed line comments and export, plus manifest and service-worker behavior.

To point the browser suite at an already running instance instead:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 bun run test:e2e
```

## Project layout

- `src/client/` contains the React review interface and PWA lifecycle UI.
- `src/server/` contains the Bun CLI/server, Git boundary, validation, event stream, and local review store.
- `src/shared/contracts.ts` is the typed client/server API contract.
- `scripts/dev.ts` supervises the loopback-only Vite and Bun development processes.
- `scripts/e2e-fixture.ts` serves the deterministic production smoke fixture.

All shipped fonts, icons, scripts, and styles are local. Vite asset inlining is disabled so production can enforce its Content Security Policy without third-party origins or `data:` script/style assets.
