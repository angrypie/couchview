# Native SSH bridge

**Audience:** People connecting Zed, Codex, a terminal, or Claude Code to a remote Couchview host.

## Native SSH bridge (Zed, Codex, terminal, and Claude Code)

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

### Origin access and tunnel independence

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
