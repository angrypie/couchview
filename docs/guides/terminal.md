# Terminal

**Audience:** People using or administering the persistent Ghostty/tmux terminal.

## Ghostty tmux terminal

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

### Optional direct terminal path

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
