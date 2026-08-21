# Security and local state

**Audience:** Everyone running Couchview, especially over a LAN, tunnel, or reverse proxy.

Couchview can read registered repositories, modify their Git indexes, execute declared package and
artifact commands, and optionally control a tmux shell. Loopback is the safe default. Do not expose
Couchview to an untrusted network without a real authentication boundary.

## Network and request protection

Every request must use a Host value derived from the configured bind host, the machine interfaces
captured at startup, or an explicitly configured trusted origin. For ordinary browser HTTP and API
requests with an Origin header, that normalized origin must exactly match the allowlist. The server
reflects only that accepted origin in `Access-Control-Allow-Origin` on API responses; it never emits
a wildcard. Credentialed native-client and bridge protocols authenticate at their own boundaries.
Browser mutations, including Codex generation, also require an Origin header and the per-launch
CSRF token. HTTP responses carry a restrictive Content Security Policy. Git runs through
`simple-git` with argument arrays, an inactivity timeout, bounded output, and validated
repository-relative paths. Loopback binding is the default. Use `--host 0.0.0.0` only to opt into
LAN access on a trusted network; the tool can read selected repositories, stage files in their
indexes, execute their declared package scripts, send staged change context to Codex, and—only with
explicit non-loopback terminal opt-in—control tmux and its programs as the Couchview OS user.

## Local state

Review flags and the saved-project catalog are stored in a user-only SQLite database using WAL mode:

```sh
${XDG_DATA_HOME:-$HOME/.local/share}/couchview/state.sqlite
```

Only an absolute `XDG_DATA_HOME` is honored; relative values fall back to `$HOME/.local/share`. Production and development servers share this database unless launched with different absolute data homes. Repository files are opened lazily, and concurrent local servers observe catalog and review changes through SQLite revisions. Package-run history and its bounded output are memory-only and disappear when the server exits. Artifact definitions and build metadata live in SQLite; private payload snapshots live beside it under `couchview/artifacts/`. Each artifact retains two successful snapshots across restarts, while failed runs retain no payload and never evict a success.

## Speech credentials

CouchSpeech writes `${XDG_CONFIG_HOME:-$HOME/.config}/couchspeech/service.json` with mode 0600. It
contains service identity, protocol versions, the loopback URL, and the bearer token used only
between authorized local clients and the daemon. `COUCHVIEW_SPEECH_URL` and
`COUCHVIEW_SPEECH_TOKEN` override
that file for deliberate custom local deployments. Without an installed credential,
`--enable-speech` remains unavailable unless `COUCHVIEW_SPEECH_URL` is explicitly set; setting only
that URL deliberately opts the custom deployment into tokenless access. Never place the token in
shell history, process arguments, logs, or a repository.

## Server configuration

`COUCHVIEW_ROOT`, `COUCHVIEW_HOST`, `COUCHVIEW_ALLOWED_ORIGINS`, `COUCHVIEW_TERMINAL`,
`COUCHVIEW_TERMINAL_P2P`, `COUCHVIEW_TERMINAL_STUN`, `COUCHVIEW_ENABLE_SPEECH`,
`COUCHVIEW_SPEECH_URL`, `COUCHVIEW_SPEECH_TOKEN`, `COUCHVIEW_REMOTE_BRIDGE`,
`COUCHVIEW_REMOTE_BRIDGE_P2P`, `COUCHVIEW_REMOTE_BRIDGE_STUN`,
`COUCHVIEW_REMOTE_BRIDGE_PORT`, `COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS`, `PORT`, and `STATIC_DIR`
provide startup defaults when invoking the Bun server directly; command-line repository, host,
port, terminal, speech, and remote-bridge options take precedence. `COUCHVIEW_ALLOWED_ORIGINS` is
a comma-separated list of exact trusted reverse-proxy origins and does not accept wildcards.

## Package execution

Package scripts execute on the host computer with the same operating-system permissions and environment as Couchview. The API accepts only exact scripts from detected manifests, takes no custom arguments or stdin, and protects Run and Stop with the same origin and CSRF checks as staging and committing. Those checks are not remote authentication: use package commands only with repositories and networks you trust.

## Artifact execution

Artifact commands also execute with the Couchview host user's permissions and inherited
environment. The single command field stores exact argv, ignores stdin, and cannot add custom
environment variables or shell syntax. Browser writes use origin and CSRF protection;
local CLI writes use the running instance's private control token, and paired CLI writes
use the revocable device credential. Treat every repository and paired device as trusted.
Inputs and stored payloads are limited to 2 GiB, directory snapshots reject Git metadata,
symlinks, and special files, and deleting a definition or forgetting its repository removes
only Couchview's private snapshots—not the original build output in the checkout.

## Codex generation

Codex generation requires `codex` on the server `PATH` and an existing `codex login`.
Commit messages receive only a bounded staged patch, staged path metadata, and up to ten recent
commit subjects. Artifact suggestions receive only allowlisted build configuration collected to
a bounded depth and size; source files, dependencies, outputs, hidden directories, binary files,
and symlinks are excluded. Both use the model and reasoning effort saved in the active Settings
profile (Luna/low by default). Each ephemeral Codex process runs from a temporary non-repository
directory in a read-only sandbox and cannot inspect the supplied repository.

## Rebuild and restart

The rebuild-and-restart action runs only Couchview's fixed `bun run build` command and
relaunches the same CLI path, repository, bind host, and port. It accepts no command or path
from the browser and uses the same origin and CSRF protections as other mutations.

## Related guidance

- [Remote and mobile access](guides/remote-access.md)
- [Terminal](guides/terminal.md)
- [Native SSH bridge](guides/remote-bridge.md)
- [Repository artifacts](guides/artifacts.md)
