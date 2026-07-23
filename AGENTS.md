# Repository Guidelines

## Project Structure & Module Organization

`src/client/` holds the React UI, PWA lifecycle, styles, and API helpers; `src/server/` holds the Bun CLI/server, Git operations, validation, and review state. Shared API types live in `src/shared/contracts.ts`. Unit and integration tests are co-located as `*.test.ts(x)`, while mobile Playwright tests live in `tests/e2e/`. Use `scripts/` for launch and fixture tools and `public/` for static assets.

## Build, Test, and Development Commands

- `bun install` installs the exact versions recorded in `bun.lock`.
- `bun run dev -- --repo /path/to/repo` starts the Bun API and Vite UI for development.
- `bun run build` creates the production PWA in `dist/`.
- `bun run typecheck` checks strict TypeScript without emitting files.
- `bun test` runs tests under `src/`; `bun run test:watch` reruns them on changes.
- `bun run test:e2e` builds and runs the serial Playwright mobile suite. Install browsers once with `bunx playwright install chromium webkit`.

Use Bun 1.3 or newer. Before submitting, run type checking, unit tests, and a production build. Run Playwright for behavior or layout changes.

## Coding Style & Naming Conventions

Write strict TypeScript and React function components. Follow existing style: two-space indentation, double quotes, semicolons, and trailing commas in multiline constructs. Use `PascalCase` for components and types and `camelCase` for functions, variables, and utility files such as `commentExport.ts`. Keep client/server boundaries explicit through shared contracts. No formatter or linter is configured; preserve nearby formatting.

## Testing Guidelines

Use Bun's `describe`, `test`, and `expect`; component tests use Happy DOM and Testing Library. Name tests after observable behavior and keep fixtures deterministic. Playwright specs should prefer roles or stable semantic locators. There is no numeric coverage threshold, but bug fixes need regression tests and new branches should exercise success and failure paths.

## Commit & Pull Request Guidelines

History currently contains only `init`, so no commit convention is established. Use short, imperative subjects such as `Reject stale staging requests` and keep commits focused. Pull requests should explain user-visible impact, list verification commands, link issues, and include screenshots or recordings for UI changes. Call out security, Git-index, caching, or PWA changes.

## Security & Configuration

Keep `0.0.0.0` as the application and development default so phone access works without flags. Warn users to run only on trusted networks or choose `--host 127.0.0.1`, because the server exposes repository contents and staging controls. Review state belongs in the XDG data database, never in repository files. Do not commit credentials, `dist/`, or Playwright reports.
