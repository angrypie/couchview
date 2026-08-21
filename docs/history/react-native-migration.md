# React Native migration

- **Status:** Historical snapshot; completed and partially stale
- **Owner:** Couchview maintainers
- **Last verified:** 2026-08-22
- **Archived:** 2026-08-22
- **Superseded by:** [ARCHITECTURE.md](../../ARCHITECTURE.md) and
  [Unified diff viewer design](../diff/design.md)

> This document preserves the migration record as it was written when the migration completed.
> Statements below about current renderer boundaries, file paths, test totals, and unresolved work
> describe that dated snapshot and are not authoritative for the current product. In particular,
> Pierre Diff and its former DOM file have since been removed. Use the documents linked above for
> the current architecture.

## Current status correction (2026-08-22)

- **Diff renderer:** Pierre and the former
  `src/client/components/diff/diff-dom-view.tsx` path are gone. The current WebView-free renderer
  uses one shared Legend List surface with platform row hosts; see
  [Unified diff viewer design](../diff/design.md).
- **DOM boundaries:** only the live Ghostty terminal and Ghostty typography preview remain Expo DOM
  documents. The historical three-island count below is no longer current.
- **Native diff font:** the former Iosevka follow-up is resolved. The native diff path loads bundled
  regular and bold TTF assets in
  [`fonts.native.ts`](../../src/client/components/diff/fonts.native.ts); ordinary application text
  is not part of the diff geometry contract.
- **Android:** development-build runtime and layout acceptance remain open; this record makes no
  Android verification claim.
- **Native terminal renderer:** this remains a dependency-watch item. The Ghostty DOM boundary is
  deliberately replaceable if a compatible native renderer becomes available; no implementation
  is currently planned here.

## Completion snapshot (historical)

This historical document records the migration from the hosted React DOM product surface to a
universal Expo Router application. At migration completion, the product rendered with React Native
on web and iOS; the same native path targeted Android, which had not been verified. Pierre Diff and
Ghostty were then the intentional Expo DOM boundaries, occupying three DOM islands:

- `src/client/components/diff/diff-dom-view.tsx` — former Pierre Diff path; removed.
- `src/client/components/TerminalWorkspace.tsx` — the live Ghostty terminal.
- `src/client/components/terminal/ghostty-preview-dom.tsx` — the Ghostty typography preview.

## Architecture at migration completion

- `app/` owns routes and route layouts only.
- `src/client/features/` owns stateful product capabilities, mutations, streams, and caches.
- `src/client/components/` owns feature presentation. Reusable design primitives and all visual
  variants live in `src/client/components/ui/`.
- `src/client/lib/` owns platform services, API transport, Jotai wiring, persistence, clipboard,
  downloads, dialogs, and other feature-neutral code.
- `src/shared/` remains platform-independent. `src/server/` remains the Bun/Git/process boundary.

Device-local persisted state is represented by Jotai atoms. The persistence layer targets an
abstract key/value contract backed by IndexedDB on web and Nitro MMKV on native. Native client
credentials remain in SecureStore and are deliberately not stored in the general-purpose KV
store.

The root provider order is Jotai store → safe area → theme hydration → Gluestack/Uniwind UI
→ native server profiles → Expo Router. Product routes are thin and select a workspace mode;
they do not load a separate web application.

## Platform boundaries at migration completion

### Pierre Diff (former)

At migration completion, Pierre remained a focused Expo DOM component because it required workers,
DOM measurement, and a shadow-DOM renderer. React Native owned the route, file and hunk controls,
loading/error states, search interactions, and review/staging actions. The DOM boundary received
serializable diff and display data and reported token clicks and visible-line changes through async
actions.

The previous cross-boundary imperative ref and worker-pool hook had been removed. The host sent a
serializable command revision, while prewarming and Pierre worker ownership remained inside the DOM
document. This entire Pierre boundary was removed after the snapshot.

### Ghostty terminal

Ghostty remains an Expo DOM component because its renderer uses WASM and canvas. There are two
reachable Ghostty documents: the live tmux terminal and the settings typography preview. The live
terminal receives serializable renderer/session configuration and async host actions for
authenticated attachment, lease renewal, confirmation, and session termination. Renderer input,
canvas, WebSocket/WebRTC, latency measurement, and helper-key behavior remain inside that boundary.
The root workspace owns one product tree across the thin Expo routes, so Review, Settings, and
Terminal transitions preserve a mounted terminal. DOM callback targets are read through stable
refs because Expo may replace callback proxy identities without changing the underlying action.

Expo's native DOM serializer previously emitted shared split-chunk references that were absent
from an individual DOM document. Metro now disables split chunks only for graphs marked
`transform.dom`, making each island self-contained without changing normal web chunking.

Imports that select between platform implementations omit the file extension. Expo therefore
selects a `.native.ts(x)` override on native; browser code may use an explicit `.web.ts(x)` file
or the default `.ts(x)` implementation when a native sibling exists. This is the seam that keeps
browser keyboard, history, storage, and overlay APIs out of native bundles.

### Web-only lifecycle

PWA installation, service-worker updates, browser cache recovery, and Cloudflare Access redirects
remain web-only platform implementations. They are not part of the native product surface.

## Differences from the previous product

- Native product routes render React Native directly instead of navigating a full hosted PWA in a
  WebView.
- Navigation is owned by Expo Router rather than `window.history`.
- The visual system is semantic Uniwind tokens plus project-owned Gluestack v5 primitives.
- Browser `localStorage` and native AsyncStorage are replaced by the Jotai KV abstraction.
- Native API requests use the selected server origin and the native client credential on every
  read, mutation, stream, terminal ticket, and download boundary.
- Native artifact downloads use Expo FileSystem and Sharing with authenticated headers; web
  downloads use the browser platform implementation.
- Native destructive confirmations use React Native alerts; web uses the browser platform file.
- Clipboard and URL opening use Expo universal modules instead of DOM APIs.
- The Vite/ReactDOM entry, full-product WebView bridge, native query marker, global feature CSS,
  `cmdk`, `lucide-react`, and AsyncStorage were removed.
- `bun run dev` now launches Expo/Metro web beside the Bun API. The explicit development API
  origin is CORS-allowlisted; production web remains same-origin.
- Layouts are mobile-first React Native flex layouts. Desktop web retains a compact multi-pane
  workspace but does not attempt pixel-for-pixel compatibility with the previous CSS grid.

## Feature ownership at migration completion

- Review: repository selection, change filtering, the former Pierre diff, review/stage/bulk stage,
  commit, search, package scripts/runs, command palette, failure details, and pairing overlays used
  RN UI.
- History: pagination, ref filtering, commit/file selection, historical diff, checkout, stash,
  restore, undo, and clean flows use RN UI.
- Artifacts: CRUD, suggestions, build/stop, event output, device selection, and download/share use
  RN UI plus platform services.
- Settings: profile CRUD, dirty-state confirmation, light/dark/system theme, diff display,
  typography preview, Codex configuration, and shortcuts use RN UI and Jotai persistence.
- Native IDE bridge: capability status, paired Macs, Zed/Codex/terminal/Claude commands, pairing,
  copy/open, refresh, expiry, and revoke use RN UI and a feature controller.
- Native servers: paired-server metadata uses the shared KV/Jotai layer; credentials remain in
  SecureStore; disconnected/revoked/mismatched states return to native retry/management UI.

## Intentionally reduced parity recorded at completion

The migration prioritizes repository correctness, authenticated transport, review/staging,
history, artifacts, and terminal reliability over exact legacy animation and spacing.

- Legacy CSS animations, glass effects, and pixel-identical desktop spacing were intentionally
  replaced by compact Uniwind variants.
- The live terminal keeps its renderer-specific toolbar, helper keys, and latency overlay inside
  the Ghostty DOM document. Its host API is isolated so a future fully native terminal renderer
  can replace that document without changing product routes or API authentication.
- PWA install/update/cache recovery remains web-only and is a native no-op.

## Status of the former unresolved TODOs

- **Open:** validate Android with a development build. Android was not exercised during this
  migration, so no Android runtime or layout acceptance claim is made here.
- **Resolved for the diff renderer:** native regular and bold Iosevka assets are loaded through
  [`fonts.native.ts`](../../src/client/components/diff/fonts.native.ts).
- **Dependency watch:** revisit the Ghostty DOM boundary only when a compatible native renderer is
  available. This is not an active native-terminal implementation task.

## Verification results

The totals below are preserved as migration evidence. They are not current suite counts or current
architecture claims.

### Automated checks

- The final repository-wide `bun run check:quality` passed: the architecture gate checked 377
  production files; Biome format and lint passed; both TypeScript configurations passed; all
  467 Bun tests passed with 2,540 assertions across 79 files; and the Expo web production export
  and PWA postprocessor completed. The real-HTTP native-auth test runs in an isolated child process
  so its localhost parser boundary remains deterministic inside the full suite.
- Focused React suites passed: `App` 17/17, `AppRepository` 24/24,
  `AppHistory` + `AppReview` + commands 19/19, and `TerminalWorkspace` 21/21.
- The final integrated Playwright matrix passed 66 tests, intentionally skipped 48
  platform-inapplicable cases, and had no failures across all 114 project cases. Desktop
  Playwright passed 4/4. Scoped artifact/history/repository mobile Chromium passed 3/3.
  The 430-pixel mobile smoke project passed 16 tests with one intentional landscape-only skip;
  its dedicated landscape Chromium case passed 1/1. Dirty-route browser coverage passed 1/1.
- The isolated `desktop-terminal-chromium` project passed 10/10: four desktop layout cases plus six
  real Ghostty terminal cases covering assets/canvas, one-socket Review continuity, WebRTC fallback,
  latency profiling, system typography, one post-save reattachment, and Safe Mode.
- Browser reload tests verified persistence of the light/dark preference and independent diff and
  terminal typography settings. Those tests exercise the browser platform wiring backed by
  IndexedDB; persisted Jotai behavior also has focused queued-write, error-recovery, and stale-read
  coverage.
- The production HTML/CSS audit found no product HTML or migrated feature CSS outside the three
  named Expo DOM documents. The remaining CSS is the Uniwind entry/theme and renderer-specific
  Ghostty DOM styling.
- Expo web and a clean iOS export completed with self-contained assets. The iOS export emitted the
  6.8 MB native Hermes bundle plus the three intended DOM documents, Ghostty WASM, and four
  renderer-local Iosevka WOFF2 assets without missing references. The native development build
  loaded Nitro MMKV and opened the Couchview store, providing runtime evidence for the native side
  of the KV abstraction.

### Browser comparison

The previous product at `http://127.0.0.1:4173` and the migrated Expo web product were compared on
desktop for review, settings, history, artifacts, and terminal. The migrated routes preserved the
feature and semantic interaction model, including browser back/forward and dirty-settings
confirmation. The old and migrated terminal snapshots exposed the same Review, Connected,
Direct P2P, Commands, Debug, End session, and Terminal input controls. Exact legacy CSS geometry
and animation were not acceptance criteria.

### iOS simulator acceptance

Agent-device exercised a real development build on an iPhone 16 Pro Max simulator. Verified paths
were one-use pairing and authenticated reconnect; React Native review chrome with the Pierre DOM
renderer; light/dark settings with the Ghostty typography preview; history; artifacts; and the live
Ghostty terminal. The terminal reached `Connected` and `Direct P2P`. Fixture WebRTC byte
diagnostics reported `p2pActive: true` and captured the exact probe prefix
`["e", "c", "h", "o", " ", "I", "O", "S", "_", "O", "K", "\r"]`, followed by later helper
inputs and resize events.

This acceptance pass exposed native-only integration defects that were fixed and rechecked:
browser shortcut and overlay modules now resolve to their native implementations, review and
terminal chrome respect safe areas, the DOM back action no longer attempts to serialize the click
event through its callback, and the terminal helper row includes a tested Enter key. A final fresh
development build rechecked the persistent workspace ownership after these fixes: Review rendered
Pierre, Terminal rendered Ghostty with `Connected` and `Direct P2P`, and Review → Terminal returned
to the live terminal surface without a new loading state. These checks verify iOS only; Android
remains explicitly unverified.
