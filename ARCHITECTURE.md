# Couchview architecture

`src/client/App.tsx` is the composition root. It wires feature controllers,
application-wide lifecycle, and the top-level view. It must not own feature
mutations, network streams, browser overlays, or substantial screen markup.

## Client ownership

- `src/client/features/` owns stateful use cases and side effects. Each folder
  owns one product capability: repositories, review, staging, comments,
  packages, settings, commands, PWA lifecycle, notifications, or application
  shell behavior.
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

## React Native Web direction

The reusable path to React Native Web is feature logic and shared contracts,
not a mechanical replacement of DOM tags. Keep `window`, history, service
workers, clipboard, `EventSource`, and terminal/browser integrations behind
feature or platform-facing adapters. Native clients should be able to reuse
contracts and use cases while supplying different navigation, storage,
transport, and rendering implementations.

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
