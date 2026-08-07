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
stay thin: the native layout composes safe-area, server-profile, and stack
providers, while the web layout removes native navigation chrome. On web,
`src/client/expo/ProductRoot.web.tsx` delegates to the established browser
composition root. On iPhone and iPad, `src/client/expo/ProductRoot.tsx` keeps
pairing and server management native, then delegates every product route to
`NativeProductSurface`. That surface verifies the selected server identity with
the SecureStore credential before its Expo DOM WebView opens the PWA at the
paired origin. Review, commands, settings, history, artifacts, and terminal
therefore use the same `App` composition, components, same-origin HTTP, event
streams, downloads, browser history, and WebSocket behavior on mobile web and
in the native shell.

Native server profiles, secure credentials, pairing-link validation, API
transport, identity preflight, and paired-origin URL construction belong to
`src/client/features/nativeServers/`. Platform files separate AsyncStorage
metadata from SecureStore credentials. The durable native-client token never
enters the hosted PWA; it is used only by native transport to verify the paired
server before navigation. The hosted page uses the browser session and the
server's normal origin/CSRF protections. A native query marker disables PWA
installation and service-worker lifecycle UI inside the shell and exposes a
custom-scheme return to native server management. Native loading, error,
pairing, and server-manager rendering belongs to `src/client/components/native/`.

Browser-side Couchview app pairing state and API orchestration belong to
`src/client/features/nativeClients/`; the pairing panel only renders its
feature controller. On the server, `NativeClientService` owns five-minute
one-use pairing codes and token authentication, `NativeClientDatabase` owns the
stable server identity and hashed client credentials, route handlers own the
HTTP boundary, and terminal managers own device-bound ticket invalidation and
socket closure after revocation.

`bun run build` exports Expo web to `dist/`. The postprocessor adds install
metadata, extracts inline executable bootstrap code for the existing CSP,
fingerprints bundled terminal fonts, and generates a bounded app-shell service
worker. Navigation and `/api` requests remain network-only, and repository
responses are never placed in offline caches.

The shared mobile product surface reuses the complete web composition instead
of maintaining two feature UIs. Platform-independent feature logic and shared
contracts keep `window`, history, service workers, clipboard, streams, storage,
and terminal/browser integrations behind platform-facing adapters.

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

Run `bun run check:architecture`, `bun run lint`, `bun run typecheck`,
`bun test`, and `bun run build` before completion.
