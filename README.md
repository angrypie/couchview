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

Open one of the project-specific URLs printed by the command, such as `http://192.168.1.42:4173/?repo=8f14e45fceea167a5a36dedd`. Couch Review resolves the containing repository root and binds to `0.0.0.0` by default, so it is immediately reachable from other devices on the same network. Use `--host 127.0.0.1` when access should be limited to this computer.

Run `couch-review` inside another Git project while that endpoint is active to add it to the same server. The command prints whether the project was added, repeats its URL, and exits. Click the repository name in the app to switch projects; the selected repository is stored in `?repo=...`, so browser history and separate tabs can keep independent projects open. Use another `--port` when intentionally running a different Couch Review version or server instance.

### Open it from a phone

The default launch binds to all IPv4 interfaces. Start Couch Review and use a printed non-loopback URL on a phone connected to the same network:

```sh
couch-review --repo /absolute/path/to/project --port 4173
```

Startup prints every copyable address with LAN URLs first, for example:

```text
Couch Review URLs:
  http://192.168.1.42:4173/?repo=8f14e45fceea167a5a36dedd
  http://127.0.0.1:4173/?repo=8f14e45fceea167a5a36dedd
  http://localhost:4173/?repo=8f14e45fceea167a5a36dedd
Repository: /absolute/path/to/project
```

Copy the `192.168...` address into the phone browser. If it does not connect, confirm both devices are on the same Wi-Fi and allow incoming Bun connections in the computer firewall. The interface list is captured at startup, so restart Couch Review after changing networks. A specific interface address can be used instead of `0.0.0.0`, and `COUCH_REVIEW_HOST` provides the same setting through the environment.

LAN mode exposes repository diffs, staging controls, and detected package scripts to devices that can reach the computer. Use it only on a trusted network and stop the server when the review is finished. Plain `http://<LAN-IP>` works for reviewing, but mobile browsers do not treat it as a secure context: PWA installation, service workers, and direct clipboard access may be unavailable. Comment copying automatically falls back to selectable text.

To run without linking the command:

```sh
bun run build
bun run start -- --repo /absolute/path/to/project --port 4173
```

For application development, run the Bun API and Vite UI together:

```sh
bun run dev -- --repo /absolute/path/to/project
```

Development also binds both processes to `0.0.0.0` by default and prints the phone-accessible frontend URLs. The UI proxies `/api`, including server-sent events, to the loopback API endpoint at `http://127.0.0.1:3001`. Pass `--host 127.0.0.1` to keep both processes local. `PORT` can change the development API port and `COUCH_REVIEW_WEB_PORT` can change the Vite port.

## Review workflow

- Click the repository name to open the project picker. It shows canonical paths, marks the current project, and keeps missing projects visible as unavailable. **Forget** requires confirmation and permanently removes that project’s saved reviews and comments.
- Open the file drawer to jump directly to a file or filter the queue by All, Unreviewed, Reviewed, or Staged. The persistent arrow controls visit the previous or next file; `[` and `]` do the same from the keyboard.
- Use the hunk up/down controls, or `K` and `J`, to jump between changes in the current file.
- Tap an identifier in a diff to run a literal, case-sensitive project search. Results are separated into Current file and Other files. Opening a result shows a read-only source window with a one-tap return to the active diff.
- Line numbers are hidden by default so the code gets the widest possible viewport; tap `123` to reveal them. Use the adjacent line-wrap control to switch long lines between horizontal scrolling and wrapping. Both display preferences are stored in the browser. Tap a number to select a line, then another number in the same hunk to extend the range. For a replacement, select a deletion and an addition to retain exact old and new ranges in one mixed comment.
- Save any number of independent comments. The comments tray can jump to, edit, or delete them. Copy exports every current, non-stale comment as Markdown with repository-relative paths, exact old/new ranges, excerpts, and correction text. Clipboard denial opens the same text in a selectable dialog; copying never deletes comments.
- Mark reviewed to record the current content revision and automatically advance to the next unreviewed file. In compact landscape mode, Review only toggles the mark because Next is a separate adjacent control. Undo is offered. A later content change clears the review and marks existing comment anchors stale.
- Stage writes the whole file to the real Git index; once fully staged, the same control becomes Unstage and restores that path in the index from `HEAD` without changing its working copy. Review and stage are independent actions, and a stale operation is rejected instead of changing the index.
- Commit is available from the changed-files drawer once at least one path is staged. It commits exactly the current Git index with the supplied message; unstaged working-tree edits remain local, and stale or conflicted states are rejected.
- When tracked or non-ignored `package.json` files are present, the drawer adds a **Commands** view. Scripts are grouped by subproject, run with the package manager declared by the project or indicated by its nearest lockfile, and stream stdout and stderr into a reconnectable output sheet. Long-running scripts keep running when the sheet closes and can be stopped explicitly.
- If Git fails or stops producing output, Couch Review shows the operation-specific message instead of treating an empty response as a valid diff. Open **Details** to see a diagnostic ID, failure kind, exit code, and bounded Git output, or copy the complete diagnostic for reporting.
- Phone layouts share a centered floating action dock. Portrait keeps its roomier repository/file bars plus hunk and comment actions in the dock; compact landscape moves hunk/comments into its single top line and keeps only Previous, Review/Unreview, Stage/Unstage, and Next in the dock to protect vertical space.
- Use the minus and plus controls to adjust code from 9–16 px. The compact 11 px default and the selected preference are stored in the browser.

Binary and metadata-only changes remain reviewable and stageable but do not accept line comments. Very large diffs show an explicit truncation warning.

## Install as a PWA

On desktop Chrome or Edge over localhost, use the install icon in the address bar or the in-app install guidance. On iPhone or iPad, PWA installation requires Couch Review to be served through HTTPS; a plain LAN-IP URL can open the review UI but is not a secure context. When HTTPS is available, open Couch Review in Safari, tap **Share**, then **Add to Home Screen**. Launching the installed app uses the standalone, edge-to-edge interface.

The UI shell is available when disconnected, but repository data is intentionally never cached. Diffs, searches, source previews, comments, and all `/api` requests remain network-only, so the offline shell cannot display an old review as current. When a new service worker is ready, Couch Review asks before reloading the active review.

## Local state and security

The server accepts only exact origins derived from the configured bind host and the machine's interfaces at startup, requires a per-launch CSRF header for writes, disables CORS, and serves a restrictive Content Security Policy. Git runs through `simple-git` with argument arrays, an inactivity timeout, bounded output, and validated repository-relative paths. LAN binding is the default, so run Couch Review only on a trusted network or pass `--host 127.0.0.1`; the tool can read selected repositories, stage files in their indexes, and execute their declared package scripts.

Review flags, comments, and the saved-project catalog are stored in a user-only SQLite database using WAL mode:

```sh
${XDG_DATA_HOME:-$HOME/.local/share}/couch-review/state.sqlite
```

Only an absolute `XDG_DATA_HOME` is honored; relative values fall back to `$HOME/.local/share`. Production and development servers share this database unless launched with different absolute data homes. Repository files are opened lazily, and concurrent local servers observe catalog and review changes through SQLite revisions. Package-run history and its bounded output are memory-only and disappear when the server exits.

Older `.git/couch-review/state.json` files are intentionally not imported or deleted. They remain Git-private and are not pushed by normal Git operations, but Couch Review no longer reads them. `COUCH_REVIEW_ROOT`, `PORT`, and `STATIC_DIR` provide startup defaults when invoking the Bun server directly; command-line `--repo` and `--port` take precedence.

Package scripts execute on the host computer with the same operating-system permissions and environment as Couch Review. The API accepts only exact scripts from detected manifests, takes no custom arguments or stdin, and protects Run and Stop with the same origin and CSRF checks as staging and committing. Those checks are not remote authentication: use package commands only with repositories and networks you trust.

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

Playwright builds the PWA and starts its deterministic fixture on port 4174. It exercises 320 px, 375 px, and 430 px touch viewports plus compact landscape, multi-project history and tabs, horizontal containment, navigation, search, staging, comments, commits, and PWA behavior.

To point the browser suite at an already running instance instead:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 bun run test:e2e
```

## Project layout

- `src/client/` contains the React review interface and PWA lifecycle UI.
- `src/server/` contains the Bun CLI/server, global SQLite catalog, Git boundary, validation, and event stream.
- `src/shared/contracts.ts` is the typed client/server API contract.
- `scripts/dev.ts` supervises the loopback-only Vite and Bun development processes.
- `scripts/e2e-fixture.ts` serves the deterministic production smoke fixture.

All shipped fonts, icons, scripts, and styles are local. Vite asset inlining is disabled so production can enforce its Content Security Policy without third-party origins or `data:` script/style assets.
