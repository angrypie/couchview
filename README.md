# Couchview

Couchview is a local-first Expo application for reviewing the combined
`HEAD → working tree` diff of a Git repository. It runs as an installable web app and as a paired
native client. Review, search, staging, commits, package commands, artifacts, history, and a
persistent terminal all remain centered on the repository you are working in.

Couchview shows staged, unstaged, partially staged, and untracked non-ignored changes in one stable
queue. Staging a file does not remove it from the queue or mark it reviewed.

## Five-minute setup

Couchview requires Git and Bun 1.4 or newer.

```sh
bun install
bun run build
bun link

cd /absolute/path/to/project
couchview
```

Open the project-specific URL printed by the command, such as
`http://127.0.0.1:4173/?repo=8f14e45fceea167a5a36dedd`. Couchview resolves the containing Git
root and binds to `127.0.0.1` by default, so the server is accessible only from this computer.

The repository and port can also be explicit:

```sh
couchview --repo /absolute/path/to/project --port 4173
```

Run `couchview` inside another Git project while the endpoint is active to add that project to the
same server. Use the repository picker in the app to switch between registered projects.

To build a standalone executable instead of linking the checkout:

```sh
bun run build:binary
./dist/couchview --repo /absolute/path/to/project
```

See [Development and verification](docs/development.md) for command-line help, interactive mode,
binary smoke testing, local development, rebuilding, project layout, and verification commands.

## Core workflow

- Use the repository name and file drawer to switch projects, filter the queue, or jump to a file.
- Move between files with the arrow controls or `[` and `]`; move between hunks with the hunk
  controls or `K` and `J`.
- Tap an identifier to search for its literal, case-sensitive uses across the project.
- Toggle line numbers and wrapping without changing the repository.
- Mark reviewed to record the current content revision. A later content change clears that mark.
- Stage and unstage whole files against the real Git index. Stale mutations are rejected.
- Commit exactly the staged index. Unstaged working-tree edits remain local.
- Run detected package scripts and inspect bounded, reconnectable output.
- Open History, Artifacts, Settings, Terminal, or Native IDE from the same repository workspace.

Binary and metadata-only changes remain reviewable and stageable. Very large diffs show an explicit
truncation warning.

## Access from another device

The default loopback binding is intentionally private. To open Couchview from a phone on a trusted
local network, opt into a reachable interface:

```sh
couchview --repo /absolute/path/to/project --host 0.0.0.0 --port 4173
```

**This exposes repository contents, Git staging and commit controls, and detected package commands
to devices that can reach the computer. Use it only on a trusted network and stop Couchview when
the review is finished.** Terminal and remote-bridge access have additional explicit opt-ins.

For phone setup, the paired iPhone/iPad app, HTTPS, Cloudflare Access, and PWA installation, read
[Remote and mobile access](docs/guides/remote-access.md). For remote IDE and SSH transport, read
[Native SSH bridge](docs/guides/remote-bridge.md).

## Optional capabilities

- [Speech and dictation](docs/guides/speech.md) covers local CouchSpeech transcription and the
  opt-in Needle 2 voice-command setup, controls, privacy, and retry behavior.
- [Terminal](docs/guides/terminal.md) covers the persistent Ghostty/tmux workspace, terminal
  authorization, WebSocket fallback, and optional direct WebRTC transport.
- [Repository artifacts](docs/guides/artifacts.md) covers safe argv-based build definitions,
  retained snapshots, downloads, and paired-client commands.
- [Security and local state](docs/security.md) documents origin checks, credentials, storage,
  execution boundaries, Codex generation, and configuration.

## Native application

The Expo app renders the same React Native product composition as Expo web. After pairing, native
requests, streams, downloads, and terminal attachments use the selected Couchview server and the
credential stored in SecureStore. The review diff uses the shared Legend List surface on native and
web; only the Ghostty live terminal and typography preview remain focused Expo DOM islands.

Keep one reachable Couchview process running on the computer. In its Native IDE or bridge sheet,
generate an app pairing link, then open or paste that link in the native app. Native development
commands and build notes are in [Development and verification](docs/development.md).

## Development quick reference

```sh
bun run dev -- --repo /absolute/path/to/project
bun run check:quality
bun run test:e2e
```

Development binds to `127.0.0.1` by default. Pass `--host 0.0.0.0` only when deliberately
testing from another device, subject to the same trusted-network warning above. Browser tests run
headlessly by default; the diff-scroll benchmark is a separate headed, focus-disrupting workflow
documented in [Diff viewer benchmarks](docs/diff/benchmarks.md).

## Documentation

Start with the audience-labelled [documentation index](docs/README.md).

- [Architecture](ARCHITECTURE.md) — current ownership and dependency direction.
- [Unified diff design](docs/diff/design.md) — current renderer, geometry, token, and accessibility
  contract.
- [Diff benchmarks](docs/diff/benchmarks.md) — reproducible performance methodology and dated
  evidence.
- [Development and verification](docs/development.md) — installation details, CLI help, tests, and
  project layout.
- [Security and local state](docs/security.md) — trust boundaries and persisted data.
- [Historical React Native migration](docs/history/react-native-migration.md) — a dated,
  non-authoritative migration record.

All shipped fonts, icons, scripts, and styles are local. The production service worker precaches
only bounded versioned assets; it does not cache repository API responses or document navigations.
