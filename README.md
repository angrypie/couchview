# Couchview

Couchview is a local-first, mobile-optimized PWA for reviewing the combined `HEAD → working tree` diff of a Git repository. It keeps code nearly full width, makes file and hunk navigation fast, searches a tapped identifier across the project, and collects line comments into a Codex-ready correction prompt.

It shows staged, unstaged, partially staged, and untracked non-ignored changes in one stable queue. Staging a file does not remove it from that queue or mark it reviewed.

## Prerequisite

Couchview requires Git and Bun 1.3 or newer. If Bun is installed in its default user directory but is not on `PATH`, add it before using the package command:

```sh
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

Put the export in the shell profile if it should persist in new terminals.

## Install and run

From this Couchview checkout, install dependencies, build the production PWA, and link the `couchview` command:

```sh
bun install
bun run build
bun link
```

Then launch it from any directory inside the Git repository to review:

```sh
cd /absolute/path/to/project
couchview
```

The repository and port can also be explicit:

```sh
couchview --repo /absolute/path/to/project --port 4173
```

Open the project-specific URL printed by the command, such as `http://127.0.0.1:4173/?repo=8f14e45fceea167a5a36dedd`. Couchview resolves the containing repository root and binds to `127.0.0.1` by default, so it is accessible only from this computer. Use `--host 0.0.0.0` to opt into access from other devices on the local network.

Run `couchview` inside another Git project while that endpoint is active to add it to the same server. The command prints whether the project was added, repeats its URL, and exits. Click the repository name in the app to switch projects; the selected repository is stored in `?repo=...`, so browser history and separate tabs can keep independent projects open. Use another `--port` when intentionally running a different Couchview version or server instance.

### Open it from a phone

To use Couchview from a phone on the same network, explicitly bind it to all IPv4 interfaces:

```sh
couchview --repo /absolute/path/to/project --host 0.0.0.0 --port 4173
```

Startup prints every copyable address with LAN URLs first, for example:

```text
Couchview URLs:
  http://192.168.1.42:4173/?repo=8f14e45fceea167a5a36dedd
  http://127.0.0.1:4173/?repo=8f14e45fceea167a5a36dedd
  http://localhost:4173/?repo=8f14e45fceea167a5a36dedd
Repository: /absolute/path/to/project
```

Copy the `192.168...` address into the phone browser. If it does not connect, confirm both devices are on the same Wi-Fi and allow incoming Bun connections in the computer firewall. The interface list is captured at startup, so restart Couchview after changing networks. A specific interface address can be used instead of `0.0.0.0`, and `COUCHVIEW_HOST` provides the same setting through the environment.

LAN mode exposes repository diffs, staging controls, and detected package scripts to devices that can reach the computer. Use it only on a trusted network and stop the server when the review is finished. Plain `http://<LAN-IP>` works for reviewing, but mobile browsers do not treat it as a secure context: PWA installation, service workers, and direct clipboard access may be unavailable. Comment copying automatically falls back to selectable text.

### Browser tmux terminal

Couchview provides one persistent tmux terminal per repository, rendered by
`ghostty-web`. Install tmux on the machine running Couchview and make it available
on `PATH`. A new session starts immediately in the repository with tmux's configured
default shell. Couchview loads the host user's normal XDG or `~/.tmux.conf` first,
then enforces persistence, mouse, focus, and true-color settings required by the
browser terminal. Review hides the mounted terminal without ending it; reconnects,
reloads, and Couchview restarts reattach to the same tmux session. **End session**
kills that session and every program running in it.

Appearance is browser-owned and never reads the host Ghostty configuration. Open
**Settings** to tune the diff and terminal independently. Both can use bundled
Iosevka or the browser's system monospace stack. Diff controls cover font size,
line height, and letter spacing; terminal controls cover font size plus pixel-based
cell height and width adjustments (the terminal grid's row and column spacing).
Cell width can be tuned from −5px to +5px. Settings has its own `/settings` route,
while preserving the selected repository when returning to Review.
Preferences are stored in the current browser. The fixed Catppuccin Mocha terminal
palette and Safe Mode defaults are bundled, while terminal renderer and WASM assets
load only after the terminal is opened and are not part of the PWA precache.

With the terminal focused, `Cmd++`/`Cmd+-` on Apple devices or `Ctrl++`/`Ctrl+-`
on Windows and Linux change only its font size; `Cmd+0` or `Ctrl+0` restores the
configured size. Couchview prevents browser zoom, re-fits tmux, and keeps
the temporary size across reconnects and Review handoffs. Reloading resets it.

Terminal access is enabled automatically only when the bind address and every
allowed origin are loopback. Disable it explicitly when desired:

```sh
couchview --disable-terminal
# or
COUCHVIEW_TERMINAL=0 couchview
```

LAN, tunnel, and reverse-proxy origins require an explicit opt-in:

```sh
couchview --host 0.0.0.0 --enable-terminal
# or
COUCHVIEW_TERMINAL=1 couchview --host 0.0.0.0
```

This opt-in is security-sensitive: browser keystrokes control tmux and its programs
with the same operating-system permissions as Couchview. Use it only on trusted networks or
behind strong authentication such as Cloudflare Access. Couchview's origin and
CSRF checks are not remote-user authentication.

Each repository gets one tmux session and one controlling browser tab. Another tab
must confirm before taking control. Switching back to Review, closing the page, or
restarting Couchview detaches the browser while tmux keeps running. **End session**
warns once before terminating every program in the session, including unsaved work.
Forgetting a repository uses the same warning.

The terminal runs on the Couchview host. If Couchview itself runs on a remote
machine, tmux, its shell, and the repository are remote automatically. The
authenticated WebSocket always provides browser attachment, authorization,
signaling, and reconnection.

#### Optional direct terminal path

Terminal traffic can opportunistically move from that WebSocket to an ordered,
reliable WebRTC DataChannel. This is a separate explicit opt-in and requires
terminal access itself to be enabled:

```sh
couchview --enable-terminal --enable-terminal-p2p
# or
COUCHVIEW_TERMINAL=1 COUCHVIEW_TERMINAL_P2P=1 couchview
```

Use `--disable-terminal-p2p` or `COUCHVIEW_TERMINAL_P2P=0` to force WebSocket
transport. P2P is disabled by default, including when terminal access is enabled
automatically on loopback. The toolbar reports **Finding direct path**, **Direct
P2P**, **WebSocket**, or **WebSocket fallback**. When ICE cannot establish a
direct route, the existing terminal stays attached over WebSocket. If an active
DataChannel is lost or exceeds its bounded backpressure buffer, Couchview
immediately reattaches over WebSocket without ending tmux; use **Retry P2P** to
make another direct-path attempt.

The default ICE discovery server is `stun:stun.cloudflare.com:3478`. Override it
with one to four comma-separated `stun:` URLs:

```sh
COUCHVIEW_TERMINAL_STUN=stun:stun.example.net:3478,stun:backup.example.net couchview \
  --enable-terminal --enable-terminal-p2p
```

There is deliberately no TURN relay. Networks that block UDP, symmetric NATs,
and restrictive firewalls can therefore prevent a direct path; WebSocket remains
the fallback. The authenticated control WebSocket stays open during P2P, and the
browser renews a same-origin authorization lease through the protected HTTP API.
Closing that controller, taking over from another tab, ending the session,
forgetting the repository, or restarting Couchview also tears down WebRTC.

P2P changes the privacy boundary: ICE can reveal peer IP addresses to the
authorized browser and Couchview host, and terminal payloads on a direct path no
longer traverse Cloudflare Tunnel. Cloudflare Access and Tunnel still protect
signaling, lease renewal, and WebSocket fallback. Enable it only when that direct
peer-to-peer exposure is acceptable.

### Remote HTTPS access through Cloudflare

Couchview can be published through
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
and protected by
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).
The origin must stay bound to loopback, and Access must be configured before the
tunnel hostname is published. A tunnel alone provides encrypted connectivity but
does not authenticate Couchview users.

Use the following account-agnostic process to configure a deployment:

1. Add the domain to Cloudflare and create a Zero Trust organization if one does
   not already exist.
2. In **Zero Trust > Integrations > Identity providers**, configure the team's
   identity provider. Email one-time PIN is sufficient for a small private
   deployment.
3. In **Zero Trust > Access controls > Applications**, create a **Self-hosted**
   application for the complete hostname, such as `couchview.example.com`.
   Create an **Allow** policy containing only the exact email addresses or
   identity-provider groups that should have access. Do not use **Everyone** or
   an unrestricted **One-time PIN** login-method rule. Select only the intended
   identity provider, use a suitably short session such as 24 hours, and enable
   the HttpOnly cookie option. Leave **Binding Cookie** disabled for browser and
   PWA access unless every client is known to preserve that additional cookie;
   a missing binding cookie makes Cloudflare reject an otherwise valid Access
   session. Use `Lax` or `None` rather than `Strict` for the cookie SameSite
   setting to avoid authentication redirect loops.
4. In **Networking > Tunnels**, create a remotely managed tunnel and install the
   displayed `cloudflared` command on the same computer as Couchview. Treat the
   tunnel token in that command as a secret and never place it in the repository.
5. Add a **Published application** route from the same hostname to
   `http://localhost:4173`. The dashboard creates the proxied tunnel DNS record;
   confirm that the route ends with a catch-all HTTP 404 rule.

Then choose how to run the Couchview origin. Both options keep it bound to
loopback; `cloudflared` is a separate process and may remain connected while
Couchview is stopped.

#### Foreground terminal

This is recommended for occasional use because the logs remain visible and
`Ctrl-C` stops the server:

```sh
COUCHVIEW_ALLOWED_ORIGINS=https://couchview.example.com \
  couchview \
  --host 127.0.0.1 \
  --port 4173 \
  --repo /absolute/path/to/project
```

Multiple exact origins may be comma-separated. Do not use wildcards.

#### macOS LaunchAgent

For an unattended server that starts after the macOS user logs in, create
`~/Library/LaunchAgents/dev.couchview.server.plist`. Replace every example
username and absolute path before loading it:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.couchview.server</string>

  <key>ProgramArguments</key>
  <array>
    <string>/Users/you/.bun/bin/bun</string>
    <string>run</string>
    <string>/absolute/path/to/couchview/src/server/cli.ts</string>
    <string>--repo</string>
    <string>/absolute/path/to/project</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>4173</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/absolute/path/to/couchview</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>COUCHVIEW_ALLOWED_ORIGINS</key>
    <string>https://couchview.example.com</string>
    <key>PATH</key>
    <string>/Users/you/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>/Users/you/Library/Logs/couchview.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/Library/Logs/couchview.err.log</string>
</dict>
</plist>
```

Validate and load the agent:

```sh
plutil -lint "$HOME/Library/LaunchAgents/dev.couchview.server.plist"
launchctl bootstrap \
  "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/dev.couchview.server.plist"
launchctl print "gui/$(id -u)/dev.couchview.server"
```

It has no attached terminal. Follow its logs with:

```sh
tail -f \
  "$HOME/Library/Logs/couchview.out.log" \
  "$HOME/Library/Logs/couchview.err.log"
```

Stop it and prevent automatic restarts with:

```sh
launchctl bootout \
  "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/dev.couchview.server.plist"
```

Use a real property-list file for this mode rather than `launchctl submit`.
The agent runs as the logged-in user and starts after login, not at the macOS
login screen. Keep the Cloudflare tunnel token out of this file and the
repository.

After starting either option, visit the external URL in a private browser
window. Cloudflare should request authentication before any Couchview response
is visible. After authenticating, verify that a diff loads and that a write such
as marking a file reviewed succeeds. Stop Couchview when remote review is not
needed; the tunnel may remain connected and will return an unavailable-origin
response.

No inbound router port or firewall rule is required because `cloudflared` opens
outbound connections to Cloudflare. If the token is disclosed, refresh it in the
tunnel's **Overview** page and reinstall the connector service with the replacement
token.

To run without linking the command:

```sh
bun run build
bun run start -- --repo /absolute/path/to/project --port 4173
```

After changing Couchview itself, open the repository picker and choose **Rebuild & restart
Couchview**. The running production server executes `bun run build` in its own Couchview
checkout, builds into a temporary directory so a failed build cannot replace the current
UI, then replaces its server worker on the same host and port and reloads the current
review. The foreground supervisor remains attached to the launching terminal, including
across repeated restarts. `couchview restart` triggers the same action from another shell.
This action is intentionally unavailable in development mode, where Vite already reloads
client changes, and when `STATIC_DIR` points at a custom build.

For application development, run the Bun API and Vite UI together:

```sh
bun run dev -- --repo /absolute/path/to/project
```

Development also binds both processes to `127.0.0.1` by default. The UI proxies `/api`, including server-sent events, to the loopback API endpoint at `http://127.0.0.1:3001`. Pass `--host 0.0.0.0` to opt into phone access and print the phone-accessible frontend URLs. `PORT` can change the development API port and `COUCHVIEW_WEB_PORT` can change the Vite port.

## Review workflow

- Click the repository name to open the project picker. It shows canonical paths, marks the current project, and keeps missing projects visible as unavailable. **Forget** requires confirmation and permanently removes that project’s saved reviews and comments.
- Open the file drawer to jump directly to a file or filter the queue by All, Unreviewed, Reviewed, or Staged. The persistent arrow controls visit the previous or next file; `[` and `]` do the same from the keyboard.
- Use the hunk up/down controls, or `K` and `J`, to jump between changes in the current file.
- Tap an identifier in a diff to run a literal, case-sensitive project search. Results are separated into Current file and Other files. Opening a result shows a read-only source window with a one-tap return to the active diff.
- Line numbers are hidden by default so the code gets the widest possible viewport; tap `123` to reveal them. Use the adjacent line-wrap control to switch long lines between horizontal scrolling and wrapping. Both display preferences are stored in the browser. Tap a number to select a line, then another number in the same hunk to extend the range. For a replacement, select a deletion and an addition to retain exact old and new ranges in one mixed comment.
- Save any number of independent comments. The comments tray can jump to, edit, or delete them. Copy exports every current, non-stale comment as Markdown with repository-relative paths, exact old/new ranges, excerpts, and correction text. Clipboard denial opens the same text in a selectable dialog; copying never deletes comments.
- Mark reviewed to record the current content revision and automatically advance to the next unreviewed file. In compact landscape mode, Review only toggles the mark because Next is a separate adjacent control. Undo is offered. A later content change clears the review and marks existing comment anchors stale.
- Stage writes the whole file to the real Git index; once fully staged, the same control becomes Unstage and restores that path in the index from `HEAD` without changing its working copy. Review and stage are independent actions, and a stale operation is rejected instead of changing the index.
- Commit is available from the changed-files drawer once at least one path is staged. It commits exactly the current Git index with the supplied message; unstaged working-tree edits remain local, and stale or conflicted states are rejected. **Generate with Codex** uses the signed-in local Codex CLI to propose an editable, single-line Conventional Commit from the staged patch; generation never stages or commits changes.
- When tracked or non-ignored `package.json` files are present, the drawer adds a **Commands** view. Scripts are grouped by subproject, run with the package manager declared by the project or indicated by its nearest lockfile, and stream stdout and stderr into a reconnectable output sheet. Long-running scripts keep running when the sheet closes and can be stopped explicitly.
- If Git fails or stops producing output, Couchview shows the operation-specific message instead of treating an empty response as a valid diff. Open **Details** to see a diagnostic ID, failure kind, exit code, and bounded Git output, or copy the complete diagnostic for reporting.
- Phone layouts share a centered floating action dock. Portrait keeps its roomier repository/file bars plus hunk and comment actions in the dock; compact landscape moves hunk/comments into its single top line and keeps only Previous, Review/Unreview, Stage/Unstage, and Next in the dock to protect vertical space.
- Use the minus and plus controls to adjust diff code from 9–24 px, or open **Settings** for all typography controls. The compact 11 px default and the selected preferences are stored in the browser.

Binary and metadata-only changes remain reviewable and stageable but do not accept line comments. Very large diffs show an explicit truncation warning.

## Install as a PWA

On desktop Chrome or Edge over localhost, use the install icon in the address bar or the in-app install guidance. On iPhone or iPad, PWA installation requires Couchview to be served through HTTPS; a plain LAN-IP URL can open the review UI but is not a secure context. When HTTPS is available, open Couchview in Safari, tap **Share**, then **Add to Home Screen**. Launching the installed app uses the standalone, edge-to-edge interface.

Couchview always loads documents and repository data from the network. The service worker never caches `index.html`, handles document navigations, or caches `/api` responses, so an installed app cannot hide a Cloudflare Access sign-in behind a stale offline shell. It precaches only the versioned core JavaScript and CSS plus common JavaScript, TypeScript, JSX, TSX, JSON, CSS, HTML, and Markdown grammars. Other syntax assets load on demand and are warmed automatically when Couchview preloads adjacent diffs. The Ghostty terminal chunk, WASM runtime, and bundled Iosevka faces also stay out of the precache and load only when the tmux terminal is opened. When a new service worker is ready, Couchview asks before reloading the active review.

## Local state and security

The server accepts only exact origins derived from the configured bind host and the machine's interfaces at startup, requires a per-launch CSRF header for writes and Codex generation, disables CORS, and serves a restrictive Content Security Policy. Git runs through `simple-git` with argument arrays, an inactivity timeout, bounded output, and validated repository-relative paths. Loopback binding is the default. Use `--host 0.0.0.0` only to opt into LAN access on a trusted network; the tool can read selected repositories, stage files in their indexes, execute their declared package scripts, send staged change context to Codex, and—only with explicit non-loopback terminal opt-in—control tmux and its programs as the Couchview OS user.

Review flags, comments, and the saved-project catalog are stored in a user-only SQLite database using WAL mode:

```sh
${XDG_DATA_HOME:-$HOME/.local/share}/couchview/state.sqlite
```

Only an absolute `XDG_DATA_HOME` is honored; relative values fall back to `$HOME/.local/share`. If a database already exists at the pre-rename `couch-review` path and the new path does not exist, Couchview continues using it so saved reviews and comments remain available. Production and development servers share this database unless launched with different absolute data homes. Repository files are opened lazily, and concurrent local servers observe catalog and review changes through SQLite revisions. Package-run history and its bounded output are memory-only and disappear when the server exits.

Older `.git/couch-review/state.json` files are intentionally not imported or deleted. They remain Git-private and are not pushed by normal Git operations, but Couchview no longer reads them. `COUCHVIEW_ROOT`, `COUCHVIEW_ALLOWED_ORIGINS`, `COUCHVIEW_TERMINAL`, `COUCHVIEW_TERMINAL_P2P`, `COUCHVIEW_TERMINAL_STUN`, `PORT`, and `STATIC_DIR` provide startup defaults when invoking the Bun server directly; command-line `--repo`, `--port`, `--enable-terminal`, `--disable-terminal`, `--enable-terminal-p2p`, and `--disable-terminal-p2p` take precedence. `COUCHVIEW_ALLOWED_ORIGINS` is a comma-separated list of exact trusted reverse-proxy origins and does not accept wildcards. Pre-rename `COUCH_REVIEW_*` variables remain accepted as lower-priority fallbacks.

Package scripts execute on the host computer with the same operating-system permissions and environment as Couchview. The API accepts only exact scripts from detected manifests, takes no custom arguments or stdin, and protects Run and Stop with the same origin and CSRF checks as staging and committing. Those checks are not remote authentication: use package commands only with repositories and networks you trust.

Commit-message generation requires `codex` on the server `PATH` and an existing
`codex login`. Couchview sends Codex only a bounded staged patch, staged path metadata,
and up to ten recent commit subjects. The ephemeral Codex process runs from a temporary
non-repository directory in a read-only sandbox using `gpt-5.6-luna`; it cannot inspect
unstaged files through the supplied workspace.

The rebuild-and-restart action runs only Couchview's fixed `bun run build` command and
relaunches the same CLI path, repository, bind host, and port. It accepts no command or path
from the browser and uses the same origin and CSRF protections as other mutations.

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

Playwright builds the PWA and starts its deterministic fixture on port 4174. It exercises 320 px, 375 px, and 430 px touch viewports plus compact landscape, multi-project history and tabs, horizontal containment, navigation, search, staging, comments, commits, and PWA behavior. A desktop Chromium project also runs the real Ghostty/WASM renderer against a deterministic terminal WebSocket and verifies lazy renderer and Iosevka loading, input, resize, Review handoff, and tmux session shutdown.

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
