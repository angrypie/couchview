# Couchview architecture

`src/client/App.tsx` is the composition root. It wires feature controllers,
application-wide lifecycle, and the top-level view. It must not own feature
mutations, network streams, browser overlays, or substantial screen markup.

## Client ownership

- `src/client/features/` owns stateful use cases and side effects. Each folder
  owns one product capability: repositories, review, staging,
  packages, artifacts, settings, commands, PWA lifecycle, notifications, or
  application shell behavior.
- `src/client/components/` owns rendering and local presentation behavior.
  Components may consume feature controllers; feature code must not import
  components.
- `src/client/lib/` contains small client utilities with no feature ownership.
- `src/shared/` contains platform-independent contracts and settings. It must
  not import client or server implementations.
- `src/server/` owns Bun, Git, persistence, process, terminal, and remote-bridge
  implementations. Client code must not import it.

Internal imports in `App.tsx` are restricted to `features/`, `components/`, and
`lib/`. A new responsibility must be placed in its owning feature before it is
wired into the composition root.

## Git workspace module

The Git workspace is a cohesive internal module with public entry points at
`src/shared/git/index.ts`, `src/client/features/git/index.ts`,
`src/client/components/git/index.ts`, and `src/server/git/index.ts`. Code outside
each module directory must use its entry point instead of importing an
implementation file. The server entry exposes both the repository-facing Git
capability and the injectable command-execution port; staging and committing
share its mutation coordinator with history actions.

See `src/server/git/README.md` for ownership and replacement seams. The
repository architecture checker enforces these entry-point boundaries.
The client presents the module as the URL-backed `/history` workspace page;
route state belongs to the shell navigation feature, while history data and
mutations remain owned by the Git feature controller.

## Artifact workspace

The URL-backed `/artifacts` workspace keeps catalog and proposal loading, stale-response
protection, mutations, polling, and run-event streams in
`src/client/features/artifacts/`. Components under
`src/client/components/artifacts/` own forms, logs, attachment links, and copied
CLI commands. `App.tsx` only wires the feature controller into the application
view.

On the server, `StateDatabase` composes artifact definition and build metadata,
`ArtifactStore` owns private XDG payload capture and reconciliation, and
`ArtifactService` owns orchestration and live run state. The shared repository
command runner owns direct argv subprocesses, bounded output, concurrency, and
cancellation for both artifact and package commands. Shared contracts own
validation, the command-field argv parser, route builders, shell-safe display
quoting, and credential-free Git remote identity normalization. The artifact
proposal service owns bounded allowlisted configuration discovery and proposal
validation; the structured Codex runner owns the shared ephemeral subprocess,
model/reasoning selection, schema output, limits, and cancellation used by
artifact suggestions and commit messages.

## Expo and React Native Web surfaces

Expo Router owns the cross-platform route entry points in `app/`. Route files
stay thin and render the same React Native composition on web and native. The
root layout owns Jotai, safe-area, Uniwind theme, Gluestack overlay, native
server-profile, and navigation providers. `ProductRoot.web.tsx` configures an
optional Expo development API origin and renders React Native Web directly.
`NativeProductRoot.tsx` verifies the selected paired server, configures the
authenticated native transport, and then renders the same `App` directly. No
route loads the product through a hosted page or full-application WebView.

Reusable visual primitives, semantic variants, and third-party UI seams live in
`src/client/components/ui/`. Product presentation may compose those primitives
with React Native layout and static Uniwind classes. Stateful workflows remain
in `src/client/features/`; feature code may not import presentation components.

Ghostty's live terminal and typography preview are isolated Expo DOM components
because they require WASM, canvas, browser keyboard events, and DOM measurement.
The diff viewer remains WebView-free and is one deep module with an unchanged
public interface. `DiffView` creates a private `DiffRenderSession` containing
one immutable semantic scene, resolved geometry and visual roles, navigation
and hit-testing queries, and a bounded incremental token layer.
`LegendDiffSurface` is the only production viewport on React Native and React
Native Web. It imports `@legendapp/list/react-native`, supplies stable row keys
and authoritative fixed item sizes, keeps only the viewport and bounded
overscan mounted, and combines vertical Legend virtualization with one outer
horizontal React Native `ScrollView`. Mounted rows subscribe only to their own
token reference, so progressive highlighting does not replace or invalidate
the list. An extensionless `DiffRowView` import selects equivalent platform row
hosts: direct semantic DOM on web, and React Native `View`/`Text`/SVG on native.
Both preserve normal selection, syntax colors, identifier buttons, and
accessibility through one prop and scene contract. The web row avoids React
Native Web host-prop/style conversion during recycling; the pinned Legend web
patch advances fixed-size measurement bookkeeping from authoritative geometry
without recycled-row rectangle reads. Surface events emit document coordinates
and a settled vertical anchor; shared scene queries alone decide identifiers and
visible source lines. There is no canvas renderer, native image renderer,
runtime renderer selector, or diff-specific native UI module.

The pure pipeline in
`src/client/components/diff/engine/` owns its patch parsing, language
detection, and Shiki tokenization directly (no `@pierre/diffs` dependency):
a checkpointed streaming tokenizer with grammar-state resume, lazy grammar
loading, vendored themes, and a per-platform engine seam (Oniguruma WASM on
web, Nitro-backed native Oniguruma on Hermes with a JS-regex fallback; the
native core lives in `nitro_modules/nitro-oniguruma` and is byte-verified
against the WASM engine by `scripts/nitroOnigParity.test.ts`). See
[`docs/diff/design.md`](docs/diff/design.md) for the full design and
[`docs/diff/benchmarks.md`](docs/diff/benchmarks.md) for performance evidence.
React Native owns route navigation and the surrounding product surface. The
Metro serializer keeps each native DOM document self-contained; normal web
bundles retain split chunks.

Native server profiles, pairing-link validation, identity preflight, and
connection lifecycle belong to `src/client/features/nativeServers/`. Profile
metadata uses the shared Jotai persistence seam. Durable native credentials
remain in SecureStore and never enter the general-purpose KV store. Once a
server is selected, the native client token authenticates every API request,
event stream, terminal attachment, and artifact download. Browser production
uses same-origin requests; Expo web development uses an explicitly allowed API
origin with CORS.

`src/client/lib/storage/` defines the asynchronous key/value contract. Its web
implementation uses IndexedDB and BroadcastChannel; its native implementation
uses Nitro-backed MMKV. `src/client/lib/store/` exposes hydration-safe persisted
Jotai atoms so features never import either storage implementation directly.

Browser-side Couchview app pairing state and API orchestration belong to
`src/client/features/nativeClients/`; the pairing panel only renders its
feature controller. On the server, `NativeClientService` owns five-minute
one-use pairing codes and token authentication, `NativeClientDatabase` owns the
stable server identity and hashed client credentials, route handlers own the
HTTP boundary, and terminal managers own device-bound ticket invalidation and
socket closure after revocation.

`bun run build` exports Expo web to `dist/`. The postprocessor adds install
metadata, extracts inline executable bootstrap code for the existing CSP,
and generates a bounded app-shell service worker. Navigation and `/api`
requests remain network-only, and repository responses are never placed in
offline caches. `bun run dev` runs the Bun API beside Expo/Metro web; Vite and
the legacy ReactDOM entry are not part of the application.

Platform-independent feature logic and shared contracts keep browser history,
service workers, clipboard, streams, downloads, storage, and native dialogs
behind platform-facing adapters. Imports that select between platform
implementations must omit the file extension so Expo can select a
`.native.ts(x)` implementation on native. The browser side may be an explicit
`.web.ts(x)` file or the default `.ts(x)` file when a `.native.ts(x)` sibling
provides the native override. Browser globals are allowed only in those browser
implementations, PWA lifecycle code, tests, and the explicit DOM islands.

## Enforced limits

[`biome.jsonc`](biome.jsonc) is the sole authority for file and function line
limits. Direct Biome 2.5 rules also enforce cognitive-complexity ceilings,
import cycles, unused code, React correctness, and core security checks. The
repository-specific architecture checker owns only import direction and the
ban on blanket suppressions.

- `App.tsx`: at most 300 nonblank lines.
- Production TSX/TS/CSS: 700/700/800 nonblank lines.
- Tests: 1,000 nonblank lines.
- Production TSX functions: at most 250 nonblank lines.
- Other production TypeScript functions: at most 300 nonblank lines.
- There are no legacy size waivers or path-specific exceptions.

Do not raise a limit, add an exclusion, insert a blanket suppression, or alter
the checker to make a product change pass unless the user explicitly requests
an architecture-policy change.

Run `bun run check:quality` as the canonical completion gate. It includes the architecture,
formatting, lint, typecheck, scoped `bun run test`, and production-build checks; run relevant
Playwright projects as additional verification for behavior or layout changes.
