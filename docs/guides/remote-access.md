# Remote and mobile access

**Audience:** People opening Couchview from another device or publishing it behind HTTPS.

## Open it from a phone

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

## Native iPhone and iPad app

The Expo app renders the same React Native product composition as Expo web. After it verifies the
selected paired server with the device credential stored in SecureStore, native requests,
streams, downloads, and terminal attachments use that server origin and credential directly.
Review, commands, settings, Git history, artifacts, and their surrounding terminal UI do not load
a hosted PWA or full-product WebView. The unified diff uses the same semantic React Native Legend
List surface on native and web. Only the Ghostty live terminal and typography preview remain
focused Expo DOM islands for their browser worker, WASM, and canvas requirements. Pairing and
paired-server management are native.

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


## Remote HTTPS access through Cloudflare

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

### Foreground terminal

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

### macOS LaunchAgent

For an unattended server that starts after the macOS user logs in, create
`~/Library/LaunchAgents/dev.couchview.server.plist`. Replace every example
username and absolute path before loading it:

This server agent is independent from the managed `dev.couchspeech.couchspeechd` agent installed by
`couchspeech start`; do not combine their labels or process arguments.

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


## Install as a PWA

On desktop Chrome or Edge over localhost, use the install icon in the address bar or the in-app install guidance. On iPhone or iPad, PWA installation requires Couchview to be served through HTTPS; a plain LAN-IP URL can open the review UI but is not a secure context. When HTTPS is available, open Couchview in Safari, tap **Share**, then **Add to Home Screen**. Launching the installed app uses the standalone, edge-to-edge interface.

Couchview always loads documents and repository data from the network. The service worker never caches `index.html`, handles document navigations, or caches `/api` responses, so an installed app cannot hide a Cloudflare Access sign-in behind a stale offline shell. It precaches only the versioned core JavaScript and CSS plus common JavaScript, TypeScript, JSX, TSX, JSON, CSS, HTML, and Markdown grammars. Other syntax assets load on demand and are warmed automatically when Couchview preloads adjacent diffs. The Ghostty terminal chunk, WASM runtime, and bundled Iosevka faces also stay out of the precache and load only when the tmux terminal is opened. When a new service worker is ready, Couchview asks before reloading the active review.
