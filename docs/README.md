# Couchview documentation

This index separates current operational guidance from design records, contributor policy,
research, and historical material. Start with the row matching what you are trying to do.

## Use Couchview

| Audience | Document | Purpose |
| --- | --- | --- |
| New users | [Project README](../README.md) | Product overview and five-minute setup. |
| Keyboard users | [Command Palette and Quick Picker](guides/quick-picker.md) | Cmd/Ctrl shortcuts, fuzzy Repository and file selection, controls, and implementation boundaries. |
| Phone, native, and remote-web users | [Remote and mobile access](guides/remote-access.md) | Trusted-LAN access, native pairing, Cloudflare Access, and PWA installation. |
| Speech users | [Speech and dictation](guides/speech.md) | Host-local transcription plus opt-in Needle setup, controls, privacy, and retry behavior. |
| Terminal users | [Terminal](guides/terminal.md) | Persistent tmux behavior, authorization, and optional WebRTC transport. |
| Remote IDE users | [Native SSH bridge](guides/remote-bridge.md) | Pair Zed, Codex, terminals, or Claude Code with a remote host. |
| Artifact users | [Repository artifacts](guides/artifacts.md) | Define, build, retain, and download repository outputs. |
| Operators and security reviewers | [Security and local state](security.md) | Network, credential, execution, storage, and Codex trust boundaries. |

## Build and maintain Couchview

| Audience | Document | Purpose |
| --- | --- | --- |
| Contributors | [Development and verification](development.md) | Installation details, CLI usage, local development, tests, and project layout. |
| Contributors and reviewers | [Architecture](../ARCHITECTURE.md) | Authoritative module ownership and dependency direction. |
| Contributors | [Domain glossary](../CONTEXT.md) | Shared product terminology for repositories, changes, review marks, and queues. |
| Diff maintainers | [Unified diff viewer design](diff/design.md) | Current scene, virtualization, geometry, token, and accessibility contract. |
| Performance maintainers | [Diff viewer benchmarks](diff/benchmarks.md) | Benchmark method, gates, and dated evidence. |
| Git-boundary maintainers | [Git workspace module](../src/server/git/README.md) | Ownership and replacement seams for repository operations. |
| Policy maintainers | [Static-analysis policy](static-analysis-policy.md) | Adopted and deferred lint and formatting policy. |
| Agents | [Repository instructions](../AGENTS.md) | Required development, verification, and automation rules. |
| Agents | [Domain documentation guide](agents/domain.md) | How to locate domain knowledge and decisions. |
| Agents | [Local issue tracker](agents/issue-tracker.md) | How temporary local `.scratch` specifications and issues are organized. |

## Research and history

These documents are evidence or historical context, not current implementation instructions.

| Audience | Status | Document | Purpose |
| --- | --- | --- | --- |
| Voice-command maintainers | Research note | [Needle tool-description quality](research/needle-tool-description-quality.md) | Evidence and an evaluation proposal for the command catalogue. |
| Migration historians | Historical snapshot | [React Native migration](history/react-native-migration.md) | Completed migration record; current architecture supersedes stale claims. |
| Migration historians | Superseded plan | [Original migration plan](history/react-native-migration-plan.md) | Original brief preserved only for context. |
| Diff maintainers | Completed checklist | [Diff engine goal](history/diff-engine-goal.md) | Closed implementation checklist and follow-up record. |

## Document lifecycle

Current design, benchmark, migration, and research documents state their status, owner, last
verification date, and superseding document when applicable. Historical test totals and machine
measurements may remain in dated records. Living guidance should describe stable commands and
invariants rather than copying totals that change whenever the suite grows.
