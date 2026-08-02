# Strict line-count policy and hotspot refactor plan

## Target policy

Biome is the only owner of line-count rules. The repository-specific architecture checker owns
only dependency direction and blanket-suppression rejection.

- `src/client/App.tsx`: 300 nonblank lines per file.
- Production TypeScript and TSX under `src/`, `scripts/`, and `.codex/hooks`: 700 nonblank lines
  per file.
- Production CSS: 800 nonblank lines per file.
- Tests under `src/`, `scripts/`, and `tests/`: 1,000 nonblank lines per file.
- Production TSX functions: 250 lines.
- Other production TypeScript functions: 300 lines.
- No legacy ceilings, path-specific size waivers, blanket suppressions, or ignored source roots.

Biome counts nonblank comment lines. Existing limits are therefore evaluated using Biome's
native semantics rather than preserving the removed custom counter's numbers.

## Responsibility moves

| Hotspot | Responsibility to move | Destination and state owner | Side effects and dependencies | Verification |
| --- | --- | --- | --- | --- |
| `ProfileSettingsWorkspace.tsx` | Profile form sections and typography controls | Settings feature state plus presentation components | Settings API and local form state | Profile settings component tests |
| `TerminalWorkspace.tsx` | Connection lifecycle, WebSocket/WebRTC transport, latency, and terminal rendering | Terminal feature controller plus terminal components | Browser storage, WebSocket, WebRTC, Ghostty | Terminal workspace tests and terminal E2E |
| `cliCommand.ts` | Option schema, parsing, help, completions, and interactive prompting | Focused CLI command modules | `util.parseArgs`, readline, shell text generation | CLI command and CLI tests |
| `cli.ts` | Supervision, restart/discovery, static build replacement, registration, and startup | Focused CLI runtime modules | Processes, filesystem, HTTP probes, server startup | CLI tests |
| `database.ts` | Schema/migrations and domain persistence groups | Database schema helpers and stores behind `StateDatabase` | SQLite transactions and XDG state | Database tests |
| `remoteBridgeClient.ts` | Config/SSH persistence, pairing, and proxy transport | Remote-bridge client modules | Filesystem permissions, HTTP, SSH, WebSocket | Remote bridge client tests |
| `remoteBridgeService.ts` | Pairing/authentication/tickets and active TCP/WebRTC attachments | Remote-bridge service collaborators | Database, sockets, timers, WebRTC | Remote bridge service tests |
| `repository.ts` | Snapshot/diff/search, staging/commit, review/comments, and cache/watch logic | Git repository collaborators behind `GitRepository` | Git subprocesses, filesystem, database revisions | Git repository tests |
| `server.ts` | Event streams, route families, request security, and static serving | Server handler/service modules; `createCouchviewApp` remains composition | HTTP, SSE, terminal and bridge upgrades | Server and static tests |
| `terminalSessions.ts` | tmux lifecycle/tickets and WebSocket/WebRTC attachment transport | Terminal session collaborators | tmux subprocesses, sockets, timers, WebRTC | Terminal session tests and terminal E2E |
| `e2e-fixture.ts` | Fixture data, HTTP route families, and terminal transport | E2E-only fixture modules | Bun server, fixture WebSockets/WebRTC | Playwright suite |
| Large test files | Domain-specific scenarios | Co-located test files with shared harnesses | Temporary repositories, HTTP clients, DOM | Full unit/integration suite |
| `styles.css` | Tokens/base, shell, review, settings, terminal, and responsive rules | Ordered CSS files aligned with UI ownership | Cascade and media-query order | Build and mobile Playwright suite |

## Refactor sequence

1. Install the Biome-only limits and remove the custom line counter and ratchet configuration.
2. Split low-risk test, fixture, CLI-generation, and client presentation seams.
3. Extract database and remote-client responsibilities behind existing public APIs.
4. Decompose the stateful terminal, remote-bridge, repository, and server orchestrators one
   behavior-preserving seam at a time.
5. Move CSS by UI ownership while preserving import and cascade order.
6. Run focused tests after every responsibility move, then run `bun run check:quality` and the
   relevant Playwright projects.

The goal is reduced coupling and explicit ownership. Moving contiguous line ranges into arbitrary
files without creating a coherent API does not satisfy this plan.
