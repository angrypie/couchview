# React Native migration plan

- **Status:** Completed; historical and superseded
- **Owner:** Couchview maintainers
- **Last verified:** 2026-08-22
- **Archived:** 2026-08-22
- **Superseded by:** [ARCHITECTURE.md](../../ARCHITECTURE.md) and
  [React Native migration retrospective](react-native-migration.md)

> This is the original migration brief, preserved for historical context. Do not use it as current
> implementation guidance: several named technologies, paths, verification targets, and constraints
> reflect the pre-migration product. Current work follows [ARCHITECTURE.md](../../ARCHITECTURE.md),
> [AGENTS.md](../../AGENTS.md), and the focused design documents indexed in
> [docs/README.md](../README.md).

## Original objective
Right now our application is mostry html wrapped in WebView. I want you to migrate every single part to react native.
Use only uniwind styles, no css should be migrated (only in extreeme situations).
Our design system should only be done inside componens/ui, so we can easily migrate styles and components.
Install gluestack v5 components where needed. Both uniwind and gluestack support dark/light themes. Prefer expo universal components if it is available on web and native.
Application should be cleanly split into app(routes), componets(reusable componets), features(unique code for each feature and componets), lib(all shared code, persistance, store)
Adopt universal design system 'components/ui' using uniwind theme and gluestack theme
use jotai for store and persistance, add jotai wiring lib that will have abstraction over kvstore (which is nitro mmkv on native and indexdb on web), (make it easy to switch kv store and storage if needed)

## Original approach

### Ghostty and Diff
Use expo 'use dom' to migrate terminal and piere diff. We already proved that it is working.
| Probe | Web | iOS simulator | Export size |
|---|---|---|---|
| Pierre Diff | Rendered successfully | Rendered and called back into native | 13.59 MB JS |
| Ghostty Terminal | WASM/canvas rendered | WASM loaded, canvas rendered, callback succeeded | 0.93 MB JS + 423 KB WASM |
Drop minor feature parity if necessary.
If we need web/native implementation split keep it modular so if we want in the future move to native library it gonna be easy.

### Verification
Currently we have previous 'full webview' version running on the http://127.0.0.1:4173 open it if you need to verify similarity and parity.
Check ours browser version (dont mobile adaptive version) with previous version.
Use agen-device cli (also skill) to test application in simulator and verify against our previous version.
Full visual compat with previous version is not so iportant as features and solid new design system.

### Docs and architecture
Follow react native and expo best practices.
Document in the [migration record](react-native-migration.md) all important changes: what is
different from previous version, diff between new and native features, unresolved todos.
DO NOT USE LEGACY ADAPTERS IN CODE everything should assumed to be clean project run.

## Original completion criteria
Constantly verify if all features migrated to react native, no html/css should be left (except diff and ghostty).
Use agent-device to verify our mobile is working, use codex browser to compare to the web version and previous.
If needed spawn agent to verify if evrything is working acording to plan.
