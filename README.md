# Couchview

Couchview is a local-first, universal Expo application for reviewing the combined
`HEAD → working tree` diff of a Git repository. It runs as an installable web app and a paired
native client. It keeps code nearly full width, makes file and hunk navigation fast, searches a
tapped identifier across the project, and supports review, staging, and commit workflows.

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

To build a compiled production distribution instead, run:

```sh
bun run build:binary
./dist/couchview --repo /absolute/path/to/project
```

This exports the Expo web production app, applies Couchview's PWA post-processing, and then uses
Bun's `--compile` flag to bundle the server, its packages, and the Bun runtime into
`dist/couchview`. Keep the executable in the generated `dist/` directory so it can serve the
companion web assets beside it.
`bun run test:binary` smoke-tests that existing executable without rebuilding it; CI runs
the build and smoke check in that order, outside the regular unit-test path.

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

### Command-line help

`couchview` remains the shortest way to serve the current repository, while the
explicit `serve` command or `--repo` flag selects another repository. Bare paths
such as `couchview ../project` are rejected, keeping command names distinct from
repository paths. Conventional short options and inline values are supported:

```sh
couchview serve -r /absolute/path/to/project -H 127.0.0.1 -p 4173
couchview serve /absolute/path/to/project --port 4173
couchview --repo=/absolute/path/to/project --port=4173
```

CLI options and command help are generated from the same Citty command definitions used for
argument parsing, so newly supported flags appear in help automatically:

```sh
couchview --help
couchview help serve
couchview help bridge pair
couchview artifacts download --help
couchview restart --help
couchview --version
```

For a guided launch, `-i` or `--interactive` prompts only for settings that were
not already supplied. It requires an attached terminal, so automated invocations
never wait for input:

```sh
couchview --interactive
couchview serve --interactive --repo /absolute/path/to/project
```

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

LAN mode exposes repository diffs, staging controls, and detected package scripts to devices that can reach the computer. Use it only on a trusted network and stop the server when the review is finished. Plain `http://<LAN-IP>` works for reviewing, but mobile browsers do not treat it as a secure context: PWA installation, service workers, and direct clipboard access may be unavailable.

### Native iPhone and iPad app

The Expo app renders the same React Native product composition as Expo web. After it verifies the
selected paired server with the device credential stored in SecureStore, native requests,
streams, downloads, and terminal attachments use that server origin and credential directly.
Review, commands, settings, Git history, artifacts, and their surrounding terminal UI do not load
a hosted PWA or full-product WebView. Pierre Diff and the Ghostty live terminal/typography preview
are the three focused Expo DOM islands required by their DOM, worker, WASM, and canvas renderers.
Pairing and paired-server management are native.

Run one reachable Couchview process on the computer; a separate API server is
not needed. The same `couchview --host 0.0.0.0 ...` process serves the PWA, JSON
API, event streams, artifact downloads, and terminal sockets. Keep it running
while using the app. In Couchview's bridge sheet, choose **Generate app pairing**,
then open or paste that link in the native app.

For local native development, use `bun run ios` or an installed development
client with `bun run dev:native`. A signed local Xcode build can also be made
with `bun x expo run:ios --configuration Release`. The EAS profiles are ready
for local EAS builds after the project is linked once with `bun x eas init`; then use
`bun x eas build --platform ios --profile development --local`.

### Host-run dictation

On an Apple Silicon Mac running macOS 14 or newer, Couchview can transcribe speech locally with
FluidAudio's multilingual Parakeet TDT 0.6B v3 int8 model. It is opt-in and disabled by default:

```sh
couchview --enable-speech
# or
COUCHVIEW_ENABLE_SPEECH=1 couchview
```

The first enabled startup downloads the model into FluidAudio's user cache and warms it before
Couchview advertises dictation as ready; later starts reuse the cache. Keep the generated
`couchview-speech-sidecar` beside `dist/couchview` when moving a compiled distribution. Unsupported
hosts or model startup failures leave the rest of Couchview available without a microphone control.

The shared web/iOS/Android inputs show a microphone only when both the host model and client audio
capture are ready. Press once to record and again to stop. Couchview then uploads a private mono
PCM WAV to the host and inserts only the final successful transcript at the current selection. A
final response preserves full-utterance context and keeps retries and host state simple, but it does
not show live partial captions. Recordings stop after five minutes, temporary audio is deleted after
every outcome, and Couchview does not retain transcript history.

Native clients can record while connected over trusted LAN HTTP. Browsers expose microphones only
in a secure context, so use localhost or HTTPS rather than a plain `http://<LAN-IP>` page. LAN HTTP
is also unencrypted: use only a trusted network or terminate HTTPS in front of Couchview.

[FluidAudio](https://github.com/FluidInference/FluidAudio) 0.15.5 is Apache-2.0 software. The
Parakeet model is published by [NVIDIA](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3).

### Ghostty tmux terminal

Couchview provides one persistent tmux terminal per repository, rendered by
`ghostty-web`. Install tmux on the machine running Couchview and make it available
on `PATH`. A new session starts immediately in the repository with tmux's configured
default shell. Couchview loads the host user's normal XDG or `~/.tmux.conf` first,
then enforces persistence, mouse, focus, and true-color settings required by the
Ghostty renderer. Review hides the mounted terminal without ending it; reconnects,
reloads, and Couchview restarts reattach to the same tmux session. **End session**
kills that session and every program running in it.

Appearance is device-local and never reads the host Ghostty configuration. Open
**Settings** to tune the diff and terminal independently. Both can use bundled
Iosevka or the platform's system monospace stack. Diff controls cover font size,
line height, and letter spacing; terminal controls cover font size plus pixel-based
cell height and width adjustments (the terminal grid's row and column spacing).
Cell width can be tuned from −5px to +5px. Settings has its own `/settings` route,
while preserving the selected repository when returning to Review.
Preferences are stored on the current device. The fixed Catppuccin Mocha terminal
palette and Safe Mode defaults are bundled, while terminal renderer and WASM assets
load only after the terminal is opened; the web build does not include them in the PWA
precache.

With the terminal focused, `Cmd++`/`Cmd+-` on Apple devices or `Ctrl++`/`Ctrl+-`
on Windows and Linux change only its font size; `Cmd+0` or `Ctrl+0` restores the
configured size. Couchview keeps zoom inside the renderer, re-fits tmux, and keeps
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
client renews its authorization lease through the protected HTTP API.
Closing that controller, taking over from another client, ending the session,
forgetting the repository, or restarting Couchview also tears down WebRTC.

P2P changes the privacy boundary: ICE can reveal peer IP addresses to the
authorized client and Couchview host, and terminal payloads on a direct path no
longer traverse the configured reverse proxy or tunnel. That origin still carries
signaling, lease renewal, and WebSocket fallback. Enable P2P only when direct peer
exposure is acceptable.

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

### Native SSH bridge (Zed, Codex, terminal, and Claude Code)

Couchview can make a repository on the host Mac available to a normal remote IDE
without publishing TCP port 22. Zed invokes the system OpenSSH client, OpenSSH invokes
Couchview through a generated `ProxyCommand`, and Couchview carries the complete SSH
byte stream over the configured Couchview origin. That origin can be a LAN address, a
VPS, any HTTP/WebSocket-capable reverse proxy or tunnel, or a compatible private relay.
The connection starts on a WebSocket and, when explicitly enabled and reachable, moves to an
ordered, reliable WebRTC DataChannel. If WebRTC cannot connect, WebSocket remains the
automatic fallback.

If a direct path fails after the handoff, Couchview closes that SSH transport so
OpenSSH or Zed can reconnect cleanly instead of risking duplicated or reordered SSH
bytes. A failed negotiation before handoff simply continues on WebSocket.

#### Origin access and tunnel independence

Pairing, device credentials, short-lived tickets, signaling, authorization leases,
SSH forwarding, and WebRTC are Couchview protocols. An origin-access provider only
adds headers required by an optional gateway in front of those protocols. `none` is
built in for direct LAN/VPS origins and transparent tunnels. `cloudflare-access` is a
separate adapter that obtains a header with `cloudflared`; it is not used by the bridge
core and never carries direct WebRTC traffic.

Providers have stable lowercase IDs and implement the small
`RemoteBridgeOriginAccessProvider` interface in
`src/server/remoteBridgeOriginAccess.ts`. HTTP and WebSocket creation are also injected
through `RemoteBridgeClientRuntime`, so a compatible relay can replace those connectors
without changing the SSH/WebRTC byte pump. Couchview uses
`X-Couchview-Bridge-Token` for its own device credential, leaving the standard
`Authorization` header available to OAuth, another tunnel, or a relay adapter.

An authenticated browser session is not copied into the Air's CLI. Gateway cookies are
normally browser-scoped and `HttpOnly`, and WebRTC still needs authenticated signaling,
ticket, and lease requests before a direct channel can carry SSH. To avoid `cloudflared`
on the Air, generate the pairing from a LAN or VPN origin, use a transparent origin that
does not require an extra gateway login, or install a different origin-access adapter.

A transparent tunnel or relay requires no Couchview-specific adapter when it forwards:

- POST requests for pairing claim, host-wide ticket issue, and lease renewal;
- WebSocket upgrades for `/api/remote-bridge/socket`;
- `Host`, `Upgrade`, and `Sec-WebSocket-Protocol` without rewriting their meaning.

After WebRTC activates, the origin carries only control traffic and lease renewal. It
also remains the fallback data path when ICE cannot connect. A relay with a completely
different, non-HTTP signaling protocol needs a connector implementing the same control
operations, but it does not require changes to pairing, SSH, or WebRTC framing.

On the Mac mini:

1. Enable **System Settings > General > Sharing > Remote Login** for the intended macOS
   user. Configure normal SSH key or password authentication; Couchview does not bypass
   OpenSSH authentication or host-key verification.
2. Choose how the Air reaches Couchview.

   On a trusted LAN, serve directly and open the displayed Mini address from the Air:

   ```sh
   couchview serve /absolute/path/to/project \
     --host 0.0.0.0 \
     --enable-remote-bridge \
     --enable-remote-bridge-p2p
   ```

   This path uses the `none` provider and requires no `cloudflared`. Do not expose this
   LAN mode to an untrusted network: Couchview's origin and CSRF checks are not remote
   user authentication.

   With Tailscale, install and sign in to Tailscale on both Macs, then find the Mini's
   stable Tailscale IPv4 address:

   ```sh
   tailscale ip -4
   ```

   Bind Couchview only to that address, replacing the example IP with the command's
   output:

   ```sh
   couchview serve /absolute/path/to/project \
     --host 100.101.102.103 \
     --enable-remote-bridge
   ```

   Ensure the tailnet policy allows the Air to reach TCP port `4173` on the Mini. On
   the Air, open `http://100.101.102.103:4173`, choose **Native IDE**, and run the
   generated command. It will resemble:

   ```sh
   couchview bridge pair \
     --url 'http://100.101.102.103:4173' \
     --code '<one-use-code>'
   ```

   Tailscale is the private network boundary, so this uses the `none` provider and
   requires neither `cloudflared` nor a manual `--origin-access` flag on the Air.
   Traffic stays on the origin WebSocket over Tailscale by default. Add
   `--enable-remote-bridge-p2p` on the Mini only if you also want WebRTC and accept its
   peer-address disclosure and possible alternate direct path.

   A Tailscale MagicDNS name can replace the IP in the browser and pairing URL. When
   doing so, add its exact origin, including port, to `COUCHVIEW_ALLOWED_ORIGINS`, for
   example `http://mini-name:4173`. See Tailscale's guides for
   [connecting to devices](https://tailscale.com/docs/how-to/connect-to-devices) and
   [MagicDNS](https://tailscale.com/docs/features/magicdns).

   For a VPS, reverse proxy, or tunnel, configure its exact public origin and keep a
   local Couchview origin on loopback when the connector runs on the same host:

   ```sh
   COUCHVIEW_ALLOWED_ORIGINS=https://review.example.com \
     couchview serve /absolute/path/to/project \
     --host 127.0.0.1 \
     --enable-remote-bridge \
     --enable-remote-bridge-p2p
   ```

   A transparent tunnel needs no provider. `auto`, the default, recognizes Cloudflare
   Access requests and otherwise generates a `none` pairing. To select another installed
   adapter explicitly, add `--remote-bridge-origin-access private-relay` or set
   `COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS=private-relay`.

3. For a LaunchAgent, add the bridge flags as separate `ProgramArguments`. The
   equivalent environment values are `COUCHVIEW_REMOTE_BRIDGE=1` and
   `COUCHVIEW_REMOTE_BRIDGE_P2P=1`. WebRTC is optional; omit its flag to use only the
   origin WebSocket. A loopback SSH daemon on a nonstandard port can be selected with
   `COUCHVIEW_REMOTE_BRIDGE_PORT`. The target host is deliberately fixed to a numeric
   loopback address.

Then pair the MacBook Air:

1. Install or link this Couchview CLI on the Air. Install `cloudflared` only when the
   generated command selects the `cloudflare-access` provider. LAN, VPS, transparent
   tunnel, and other provider paths do not call it.
2. Open any repository in Couchview, choose **Native IDE**, enter a device name, and
   generate a one-use command. Pairing is host-wide: the same device can open every
   repository registered in that Couchview server.
3. Run that command once in Terminal on the Air. The selected origin-access adapter
   supplies any gateway headers, then Couchview stores a private device credential,
   creates a managed OpenSSH host alias, and prints the Zed URL. With Cloudflare Access,
   `cloudflared` is used only for login and token retrieval; IDE traffic still uses
   Couchview's WebRTC path or the origin WebSocket fallback.
4. After the device appears, select any repository and reopen **Native IDE**. Couchview
   shows separate copyable Zed, Codex, terminal, and Claude Code Remote Control commands
   containing that repository's remote path. Zed performs its normal remote-server
   installation through OpenSSH on first connection.
   The Zed command follows its
   [remote-development SSH URL format](https://zed.dev/docs/remote-development):

   ```sh
   zed 'ssh://<managed-ssh-host>/absolute/path/to/registered/project'
   ```

Pairing authorizes the Couchview transport but does not replace macOS SSH
authentication. Before the first remote launch, connect to the printed SSH host once to
verify its host key and login:

```sh
ssh <couchview-ssh-host>
```

For password-free launches, install the Air's public key on the Mini first, for
example with `ssh-copy-id <couchview-ssh-host>`, and confirm that the plain `ssh`
command succeeds.

To open an ordinary remote terminal in the selected repository, run:

```sh
couchview bridge terminal \
  --profile <managed-ssh-host> \
  --repo /absolute/path/to/registered/project
```

This starts the remote account's login shell without creating or managing a persistent
session. From there the user can start `tmux`, Claude Code, Neovim, or any other terminal
tool. Closing the shell closes the SSH connection.

To start Claude Code Remote Control in the repository as a single command, run:

```sh
couchview bridge claude \
  --profile <managed-ssh-host> \
  --repo /absolute/path/to/registered/project
```

The Mini must have Claude Code installed and authenticated with a Claude.ai account.
The command runs `claude remote-control` remotely and leaves its status, session URL,
and QR code visible in the Air's terminal. After startup, browser and mobile control
traffic uses Anthropic's TLS service; Couchview carries the SSH launcher, not the Claude
conversation. The remote process remains attached to that SSH session. To keep it alive
after closing the Air's terminal, first open `couchview bridge terminal`, start `tmux`,
and run `claude remote-control` inside it. Claude arguments can follow `--`, for example:

```sh
couchview bridge claude \
  --profile couchview-project-name-12345678 \
  --repo '/Users/mini/Code/Another Project' -- \
  --name 'Another Project'
```

To keep the Codex terminal UI on the Air while Codex reads files and runs commands on
the Mini, use:

```sh
couchview bridge codex \
  --profile <managed-ssh-host> \
  --repo /absolute/path/to/registered/project
```

When only one bridge profile is stored, `--profile` can be omitted from the terminal,
Claude, and Codex launchers. Omitting `--repo` uses the repository from which the pairing
was originally created. The machine-local profile ID is also accepted, but the managed
SSH alias is easier to match with the host used for `ssh-copy-id`. Arguments after `--`
are forwarded to the Air's Codex CLI, for example:

```sh
couchview bridge codex \
  --profile couchview-project-name-12345678 \
  --repo '/Users/mini/Code/Another Project' -- \
  --model gpt-5.4
```

The launcher selects private loopback ports, starts
`codex app-server --listen ws://127.0.0.1:<port>` in the selected repository through the
Mini's login shell, waits for its readiness endpoint through an OpenSSH local forward,
and then runs `codex --remote ws://127.0.0.1:<local-port>` on the Air. The app-server
and forward stop when the local Codex TUI exits. The Air and Mini both need a compatible
Codex CLI, and the Mini must already be authenticated with `codex login`. No Codex TCP
port is exposed beyond loopback. Because the forward is an ordinary SSH channel, it
automatically uses Couchview's WebRTC path when available and its protected WebSocket
fallback otherwise.

The automation keeps Couchview profiles in
`${XDG_CONFIG_HOME:-$HOME/.config}/couchview/remote-bridges.json`, writes managed SSH
hosts to `~/.ssh/couchview_config`, and adds one `Include ~/.ssh/couchview_config` line
to `~/.ssh/config`. Directories and credential files use user-only permissions. The
generated `couchview bridge proxy` command is an OpenSSH transport helper and should
not be run manually.

Pairing codes are single-use and expire after five minutes. Persistent host-wide device
secrets are stored only as hashes on the Mini, transport tickets expire after 30
seconds, and active connections require a short renewable authorization lease.
Revoking a device from any repository's **Native IDE** removes its access to every
registered repository and disconnects its current bridge. The bridge cannot select
another TCP destination and never stores SSH private keys.

As with terminal P2P, WebRTC can expose the Mini and Air's peer addresses to each other,
has no TURN relay, and may be unavailable behind symmetric NAT or restrictive UDP
firewalls. The configured origin and optional access provider continue to protect
signaling, lease renewal, and WebSocket fallback; SSH provides end-to-end host
authentication and encryption on both transports.

### Ephemeral repository artifacts

Open **Artifacts** for a repository to type one familiar build command, a repository-relative
working directory, and one exact file or directory output. Couchview parses quotes and escapes
into exact argv, rejects shell operators and expansion, and invokes the result without a shell.
It snapshots the output only after a zero exit code and retains the latest two successful
snapshots. A directory is downloaded as a `.tar.gz`; installation, signing, and moving the
downloaded result remain the user's responsibility. Normal attachment links stream directly to
desktop and mobile browsers, including Safari on iPhone and iPad.

**Suggest with Codex** optionally accepts a short intent such as “static build” or “compile with
Bun”; leaving it empty asks for the project's most useful configured build. Couchview supplies
only recognized, shallow build configuration files under strict count and byte limits. Codex
cannot inspect source or the repository and returns one editable form draft—it never saves or
builds the suggestion automatically. The **Codex generation** settings select the model and
reasoning effort shared with commit-message generation.

The same catalog is available from a terminal. Local commands require an already-running
Couchview server and never start one implicitly:

```sh
couchview artifacts list --repo /absolute/path/to/project
couchview artifacts build couchview-cli --repo /absolute/path/to/project
couchview artifacts download couchview-cli --repo /absolute/path/to/project
couchview artifacts pull couchview-cli --repo /absolute/path/to/project
```

`pull` starts a build, streams its logs, and downloads that exact successful snapshot.
`download` selects the latest success by default; `--build <id>` selects the older retained
snapshot. Downloads use the artifact basename in the current directory, verify size and
SHA-256, and refuse to overwrite unless `--force` is supplied. Use `--output <file>` for a
different destination and `--json` for machine-readable stdout.

After pairing a client, the Artifacts page can copy an unambiguous host-wide command with
the managed SSH alias and stable server repository ID:

```sh
couchview artifacts pull couchview-cli \
  --profile couchview-project-name-12345678 \
  --repository 8f14e45fceea167a5a36dedd
```

Without an explicit repository, paired clients match credential-free hashes of normalized
Git remote host/path identities and require `--repository` if the result is not unique.
Paired clients can list, build, and download artifacts in any registered repository, but
only the browser can create, edit, or delete definitions.

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
This action is intentionally unavailable in development mode, where Expo/Metro already applies
client changes with Fast Refresh, and when `STATIC_DIR` points at a custom build.

For application development, run the Bun API and Expo/Metro web UI together:

```sh
bun run dev -- --repo /absolute/path/to/project
```

Development also binds both processes to `127.0.0.1` by default. Expo web receives the explicit
API origin `http://127.0.0.1:3001`, and the Bun API CORS-allowlists the generated frontend
origins, including server-sent-event requests. Pass `--host 0.0.0.0` to opt into phone access and
print the phone-accessible frontend URLs. `PORT` changes the development API port and
`COUCHVIEW_WEB_PORT` changes the Expo/Metro web port.

## Review workflow

- Click the repository name to open the project picker. It shows canonical paths, marks the current project, and keeps missing projects visible as unavailable. **Forget** requires confirmation and permanently removes that project’s saved review state.
- Open the file drawer to jump directly to a file or filter the queue by All, Unreviewed, Reviewed, or Staged. The persistent arrow controls visit the previous or next file; `[` and `]` do the same from the keyboard.
- Use the hunk up/down controls, or `K` and `J`, to jump between changes in the current file.
- Tap an identifier in a diff to run a literal, case-sensitive project search. Results are separated into Current file and Other files. Opening a result shows a read-only source window with a one-tap return to the active diff.
- Line numbers are hidden by default so the code gets the widest possible viewport; tap `123` to
  reveal them. Use the adjacent line-wrap control to switch long lines between horizontal
  scrolling and wrapping. Both display preferences are stored on the current device.
- Mark reviewed to record the current content revision and automatically advance to the next unreviewed file. In compact landscape mode, Review only toggles the mark because Next is a separate adjacent control. Undo is offered. A later content change clears the review.
- Stage writes the whole file to the real Git index; once fully staged, the same control becomes Unstage and restores that path in the index from `HEAD` without changing its working copy. Review and stage are independent actions, and a stale operation is rejected instead of changing the index.
- Commit is available from the changed-files drawer once at least one path is staged. It commits exactly the current Git index with the supplied message; unstaged working-tree edits remain local, and stale or conflicted states are rejected. **Generate with Codex** uses the signed-in local Codex CLI to propose an editable, single-line Conventional Commit from the staged patch; generation never stages or commits changes.
- When tracked or non-ignored `package.json` files are present, the drawer adds a **Commands** view. Scripts are grouped by subproject, run with the package manager declared by the project or indicated by its nearest lockfile, and stream stdout and stderr into a reconnectable output sheet. Long-running scripts keep running when the sheet closes and can be stopped explicitly.
- If Git fails or stops producing output, Couchview shows the operation-specific message instead of treating an empty response as a valid diff. Open **Details** to see a diagnostic ID, failure kind, exit code, and bounded Git output, or copy the complete diagnostic for reporting.
- Phone layouts share a centered floating action dock. Portrait keeps its roomier repository/file bars plus hunk actions in the dock; compact landscape moves hunk navigation into its single top line and keeps only Previous, Review/Unreview, Stage/Unstage, and Next in the dock to protect vertical space.
- Use the minus and plus controls to adjust diff code from 9–24 px, or open **Settings** for all
  typography controls. The compact 11 px default and selected preferences are stored on the
  current device.

Binary and metadata-only changes remain reviewable and stageable. Very large diffs show an explicit truncation warning.

## Install as a PWA

On desktop Chrome or Edge over localhost, use the install icon in the address bar or the in-app install guidance. On iPhone or iPad, PWA installation requires Couchview to be served through HTTPS; a plain LAN-IP URL can open the review UI but is not a secure context. When HTTPS is available, open Couchview in Safari, tap **Share**, then **Add to Home Screen**. Launching the installed app uses the standalone, edge-to-edge interface.

Couchview always loads documents and repository data from the network. The service worker never caches `index.html`, handles document navigations, or caches `/api` responses, so an installed app cannot hide a Cloudflare Access sign-in behind a stale offline shell. It precaches only the versioned core JavaScript and CSS plus common JavaScript, TypeScript, JSX, TSX, JSON, CSS, HTML, and Markdown grammars. Other syntax assets load on demand and are warmed automatically when Couchview preloads adjacent diffs. The Ghostty terminal chunk, WASM runtime, and bundled Iosevka faces also stay out of the precache and load only when the tmux terminal is opened. When a new service worker is ready, Couchview asks before reloading the active review.

## Local state and security

The server accepts only exact origins derived from the configured bind host and the machine's interfaces at startup, requires a per-launch CSRF header for writes and Codex generation, disables CORS, and serves a restrictive Content Security Policy. Git runs through `simple-git` with argument arrays, an inactivity timeout, bounded output, and validated repository-relative paths. Loopback binding is the default. Use `--host 0.0.0.0` only to opt into LAN access on a trusted network; the tool can read selected repositories, stage files in their indexes, execute their declared package scripts, send staged change context to Codex, and—only with explicit non-loopback terminal opt-in—control tmux and its programs as the Couchview OS user.

Review flags and the saved-project catalog are stored in a user-only SQLite database using WAL mode:

```sh
${XDG_DATA_HOME:-$HOME/.local/share}/couchview/state.sqlite
```

Only an absolute `XDG_DATA_HOME` is honored; relative values fall back to `$HOME/.local/share`. Production and development servers share this database unless launched with different absolute data homes. Repository files are opened lazily, and concurrent local servers observe catalog and review changes through SQLite revisions. Package-run history and its bounded output are memory-only and disappear when the server exits. Artifact definitions and build metadata live in SQLite; private payload snapshots live beside it under `couchview/artifacts/`. Each artifact retains two successful snapshots across restarts, while failed runs retain no payload and never evict a success.

`COUCHVIEW_ROOT`, `COUCHVIEW_ALLOWED_ORIGINS`, `COUCHVIEW_TERMINAL`, `COUCHVIEW_TERMINAL_P2P`, `COUCHVIEW_TERMINAL_STUN`, `COUCHVIEW_ENABLE_SPEECH`, `COUCHVIEW_REMOTE_BRIDGE`, `COUCHVIEW_REMOTE_BRIDGE_P2P`, `COUCHVIEW_REMOTE_BRIDGE_STUN`, `COUCHVIEW_REMOTE_BRIDGE_PORT`, `COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS`, `PORT`, and `STATIC_DIR` provide startup defaults when invoking the Bun server directly; command-line repository, port, terminal, speech, and remote-bridge options take precedence. `COUCHVIEW_ALLOWED_ORIGINS` is a comma-separated list of exact trusted reverse-proxy origins and does not accept wildcards.

Package scripts execute on the host computer with the same operating-system permissions and environment as Couchview. The API accepts only exact scripts from detected manifests, takes no custom arguments or stdin, and protects Run and Stop with the same origin and CSRF checks as staging and committing. Those checks are not remote authentication: use package commands only with repositories and networks you trust.

Artifact commands also execute with the Couchview host user's permissions and inherited
environment. The single command field stores exact argv, ignores stdin, and cannot add custom
environment variables or shell syntax. Browser writes use origin and CSRF protection;
local CLI writes use the running instance's private control token, and paired CLI writes
use the revocable device credential. Treat every repository and paired device as trusted.
Inputs and stored payloads are limited to 2 GiB, directory snapshots reject Git metadata,
symlinks, and special files, and deleting a definition or forgetting its repository removes
only Couchview's private snapshots—not the original build output in the checkout.

Codex generation requires `codex` on the server `PATH` and an existing `codex login`.
Commit messages receive only a bounded staged patch, staged path metadata, and up to ten recent
commit subjects. Artifact suggestions receive only allowlisted build configuration collected to
a bounded depth and size; source files, dependencies, outputs, hidden directories, binary files,
and symlinks are excluded. Both use the model and reasoning effort saved in the active Settings
profile (Luna/low by default). Each ephemeral Codex process runs from a temporary non-repository
directory in a read-only sandbox and cannot inspect the supplied repository.

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

Playwright builds the PWA and starts its deterministic fixture on port 4174. It exercises 320 px, 375 px, and 430 px touch viewports plus compact landscape, multi-project history and tabs, horizontal containment, navigation, search, staging, commits, and PWA behavior. A desktop Chromium project also runs the real Ghostty/WASM renderer against a deterministic terminal WebSocket and verifies lazy renderer and Iosevka loading, input, resize, Review handoff, and tmux session shutdown.

To point the browser suite at an already running instance instead:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 bun run test:e2e
```

## Project layout

- `app/` contains the thin universal Expo Router routes and root layout.
- `src/client/features/` contains stateful product capabilities and side effects.
- `src/client/components/` contains React Native presentation; reusable design-system primitives
  live only in `src/client/components/ui/`.
- `src/client/lib/` contains shared platform services, transport, Jotai wiring, and persistence.
- `src/server/` contains the Bun CLI/server, global SQLite catalog, Git boundary, validation, and
  event streams.
- `src/shared/contracts.ts` is the typed client/server API contract.
- `scripts/dev.ts` supervises the Expo/Metro web and Bun API development processes.
- `scripts/e2e-fixture.ts` serves the deterministic production smoke fixture.

All shipped fonts, icons, scripts, and styles are local. The Expo web postprocessor extracts
inline executable bootstrap code for the existing Content Security Policy and generates the
bounded PWA app-shell service worker without caching API or navigation responses.
