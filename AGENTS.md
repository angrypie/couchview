# Repository Guidelines

## Project Structure & Module Organization

`src/client/App.tsx` is the client composition root. Stateful use cases and side effects live in `src/client/features/`, rendering lives in `src/client/components/`, and small client utilities live in `src/client/lib/`. `src/server/` holds the Bun CLI/server, Git operations, validation, and review state. Shared API types live in `src/shared/contracts.ts`. Unit and integration tests are co-located as `*.test.ts(x)`, while mobile Playwright tests live in `tests/e2e/`. Use `scripts/` for launch and fixture tools and `public/` for static assets. See `ARCHITECTURE.md` for ownership and dependency direction.

## Build, Test, and Development Commands

- `bun install` installs the exact versions recorded in `bun.lock`.
- `bun run dev -- --repo /path/to/repo` starts the Bun API and Expo/Metro web UI for development.
- `bun run build` creates the production PWA in `dist/`.
- `bun run typecheck` checks strict TypeScript without emitting files.
- `bun run lint` runs the direct Biome 2.5 policy; `bun run format:check` verifies formatting and import organization in the adopted client areas.
- `bun run check:architecture` enforces suppression and import-boundary policy; Biome owns file and function line limits.
- `bun test` runs source and architecture-checker tests; `bun run test:watch` reruns source tests on changes.
- `bun run test:e2e` builds and runs the serial Playwright mobile suite. Install browsers once with `bunx playwright install chromium webkit`.

Use Bun 1.3 or newer. Before submitting, run `bun run check:quality`. Run Playwright for behavior or layout changes.

## Running Couchview Process

Treat a responding Couchview server as user-owned: do not stop it or start a competing instance. After verified changes, use `couchview restart` (with matching `--host`/`--port` when needed) and report failures instead of falling back to kill-and-relaunch.

## Coding Style & Naming Conventions

Write strict TypeScript and React function components. Biome defines the adopted style: tabs for indentation, double quotes, semicolons, trailing commas, LF endings, and 100-column lines. Use `PascalCase` for components and types and `camelCase` for functions, variables, and utility files such as `diffAdapter.ts`. Keep client/server boundaries explicit through shared contracts.

## Architecture Invariants

- `src/client/App.tsx` only composes modules from `features/`, `components/`, and `lib/`. Feature state, mutations, streams, browser lifecycle, and substantial rendering belong in their owning module.
- `features/` owns stateful capabilities and may not import `components/`; `components/` owns presentation; `lib/` owns small feature-neutral utilities. Keep platform-independent review logic separate from browser/native adapters.
- All source files must satisfy the Biome line limits; there are no legacy size waivers. Extract responsibilities instead of increasing a limit.
- Do not raise limits, add exclusions or blanket suppressions, weaken checker logic, or change CI enforcement unless the user explicitly requests an architecture-policy change.
- A change is not complete while `bun run check:architecture`, `bun run format:check`, `bun run lint`, or another required verification command fails.

## Code Review Rules

- Flag feature workflows, direct API or event-stream orchestration, browser lifecycle, and substantial screen markup added to the composition root.
- Flag forbidden dependency direction, policy gaming, unapproved waivers, and arbitrary file splitting that preserves the original coupling.

## User Experience & Performance

Prefer snappy, continuity-preserving interactions, especially during file navigation and repository mutations. Keep useful content mounted while background work completes instead of flashing empty or loading states for short operations. When correctness permits, prefetch likely next and previous states and reuse fetched, parsed, or rendered results through bounded caches. Cache keys must include the repository or resource identity and an authoritative content revision, stale entries must be ignored automatically, and cache limits must protect mobile memory. Use optimistic UI updates when they can be reconciled safely with an authoritative server response. Add regression coverage for visible loading flashes, redundant requests, stale-cache behavior, and back-and-forth navigation.

Keep layouts compact, especially on mobile and in persistent footer or toolbar surfaces. Do not dedicate a full row to an infrequent action when related secondary actions can share a simple grid or condensed control group. Shorten visible labels when space is limited while preserving explicit accessible names and tooltips. Prefer straightforward markup and CSS over new state, abstractions, or components for presentation-only changes.

## Testing Guidelines

Use Bun's `describe`, `test`, and `expect`; component tests use Happy DOM and Testing Library. Name tests after observable behavior and keep fixtures deterministic. Playwright specs should prefer roles or stable semantic locators. There is no numeric coverage threshold, but bug fixes need regression tests and new branches should exercise success and failure paths.

Regression verification must cross the boundary that actually failed and assert externally observable behavior. For failures involving subprocesses, PTYs, terminals, SSH, tmux, browsers, filesystems, databases, or network protocols, use the real dependency in the smallest practical integration test and reproduce both the original failure and the fixed behavior when possible. A mocked test that only captures implementation-produced arguments, environment variables, requests, or state and asserts those same values is supplemental; it is not sufficient as the primary regression test because it can be self-fulfilling. Before calling a test adequate, ask whether it would fail if the real dependency rejected the interaction in the way the user observed. If an end-to-end path is blocked, test the closest real boundary, report exactly what remains unverified and why, and do not describe the result as end-to-end.

## Commit & Pull Request Guidelines

Use short, imperative subjects such as `Reject stale staging requests` and keep commits focused. Pull requests should explain user-visible impact, list verification commands, link issues, and include screenshots or recordings for UI changes. Call out security, Git-index, caching, PWA, architecture-policy, or CI changes.

## Security & Configuration

Keep `0.0.0.0` as the application and development default so phone access works without flags. Warn users to run only on trusted networks or choose `--host 127.0.0.1`, because the server exposes repository contents and staging controls. Review state belongs in the XDG data database, never in repository files. Do not commit credentials, `dist/`, or Playwright reports.

## Agent automation

Use agent-device only for app/device automation tasks. Before planning commands, run `agent-device --version` and read `agent-device help workflow`. For exploratory QA, read `agent-device help dogfood`. For logs, network, audio, traces, or runtime failures, read `agent-device help debugging`. For React Native component trees, props/state/hooks, slow renders, or rerenders, read `agent-device help react-devtools`. For React Native JavaScript heap growth, heap snapshots, or retained-object leaks, read `agent-device help cdp`. For React Native apps, overlays, Metro/Fast Refresh blockers, and routing to React DevTools or debugging evidence, read `agent-device help react-native`.

Use MCP tools or the CLI in the integrated terminal. If `agent-device` is not on PATH but the user installed it globally in another shell, resolve the command the same way the user would from a normal terminal session and run that absolute path instead. This may require inspecting shell startup behavior or package-manager/global bin locations; do not assume the agent process `PATH` is the user's `PATH`. Do not silently fall back to `npx -y agent-device@latest`; ask or use an exact version. MCP exposes structured tools backed by the agent-device client; it does not expose generic shell execution. Prefer `open -> snapshot -i -> act -> re-snapshot -> verify -> close`. Use current refs such as `@e3` for exploration and selectors for durable replay. Keep mutating commands against one session serial. Capture screenshots, logs, network, audio, perf, traces, recordings, and `.ad` replay scripts only when they add evidence.

## React / Expo Patterns

- Prefer self-explanatory UI. Add descriptive copy only when it helps someone complete or recover from an action; do not repeat visible labels or use sales-pitch language.
- Use Uniwind `className` utilities and CSS variables for theming and static styles.
- For third-party components with compatible `style` props, prefer a module-level `withUniwind` wrapper so they can use `className`. Keep one-file wrappers local and share wrappers that have multiple consumers.
- Never wrap React Native or React Native Reanimated components with `withUniwind`; they already support `className`. Use `useResolveClassNames` for one-off non-component style props where appropriate.
- Keep cross-platform behavior aligned. Use platform-specific files only for necessary build isolation or materially different implementations; keep small platform branches inside the existing abstraction.
- Keep abstractions encapsulated, reuse existing code, and follow established project patterns instead of leaking implementation details or duplicating platform logic.

## When In Doubt

- Mirror existing patterns in nearby files.
- Keep changes scoped and minimal.
- Update or add tests only when relevant to the change.



## Lint / Formatting Rules

The project uses Biome for formatting + linting at the repo root.
- Indentation: tabs
- Quotes: double
- Semicolons: as needed
- Organize imports: enabled
- Unused imports: error (auto-fix)
