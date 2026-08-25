# Development and verification

**Audience:** Couchview contributors and release maintainers.

## Prerequisites

Couchview requires Git and Bun 1.4 or newer. If Bun is installed in its default user directory but is not on `PATH`, add it before using the package command:

```sh
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

Put the export in the shell profile if it should persist in new terminals.

## Install and run

From this Couchview checkout, install dependencies, build the production PWA, and link the `couchview` command:

```sh
bun install
bun run build
bun link
```

To build a compiled production distribution instead, run:

```sh
bun run build:binary
./dist/couchview --repo /absolute/path/to/project
```

This exports the Expo web production app, applies Couchview's PWA post-processing, and then uses
Bun's `--compile` flag to bundle the server, its packages, and the Bun runtime into
`dist/couchview`. CouchSpeech is built and distributed separately; it is not embedded in the
Couchview binary.
`bun run test:binary` smoke-tests that existing executable without rebuilding it; CI runs
the build and smoke check in that order, outside the regular unit-test path.

Then launch it from any directory inside the Git repository to review:

```sh
cd /absolute/path/to/project
couchview
```

The repository and port can also be explicit:

```sh
couchview --repo /absolute/path/to/project --port 4173
```

Open the project-specific URL printed by the command, such as `http://127.0.0.1:4173/?repo=8f14e45fceea167a5a36dedd`. Couchview resolves the containing repository root and binds to `127.0.0.1` by default, so it is accessible only from this computer. Use `--host 0.0.0.0` to opt into access from other devices on the local network.

Binding to `0.0.0.0` exposes Couchview's repository and mutation capabilities to reachable devices.
Use it only on a trusted network; see [Security and local state](security.md).

Run `couchview` inside another Git project while that endpoint is active to add it to the same server. The command prints whether the project was added, repeats its URL, and exits. Click the repository name in the app to switch projects; the selected repository is stored in `?repo=...`, so browser history and separate tabs can keep independent projects open. Use another `--port` when intentionally running a different Couchview version or server instance.


## Command-line help

`couchview` remains the shortest way to serve the current repository, while the
explicit `serve` command or `--repo` flag selects another repository. Bare paths
such as `couchview ../project` are rejected, keeping command names distinct from
repository paths. Conventional short options and inline values are supported:

```sh
couchview serve -r /absolute/path/to/project -H 127.0.0.1 -p 4173
couchview serve /absolute/path/to/project --port 4173
couchview --repo=/absolute/path/to/project --port=4173
```

CLI options and command help are generated from the same Citty command definitions used for
argument parsing, so newly supported flags appear in help automatically:

```sh
couchview --help
couchview help serve
couchview help bridge pair
couchview artifacts download --help
couchview restart --help
couchview --version
```

For a guided launch, `-i` or `--interactive` prompts only for settings that were
not already supplied. It requires an attached terminal, so automated invocations
never wait for input:

```sh
couchview --interactive
couchview serve --interactive --repo /absolute/path/to/project
```

## Rebuild, restart, and local development

To run without linking the command:

```sh
bun run build
bun run start -- --repo /absolute/path/to/project --port 4173
```

After changing Couchview itself, open the repository picker and choose **Rebuild & restart
Couchview**. The running production server executes `bun run build` in its own Couchview
checkout, builds into a temporary directory so a failed build cannot replace the current
UI, then replaces its server worker on the same host and port and reloads the current
review. The foreground supervisor remains attached to the launching terminal, including
across repeated restarts. `couchview restart` triggers the same action from another shell.
This action is intentionally unavailable in development mode, where Expo/Metro already applies
client changes with Fast Refresh, and when `STATIC_DIR` points at a custom build.

For application development, run the Bun API and Expo/Metro web UI together:

```sh
bun run dev -- --repo /absolute/path/to/project
```

Development also binds both processes to `127.0.0.1` by default. Expo web receives the explicit
API origin `http://127.0.0.1:3001`, and the Bun API CORS-allowlists the generated frontend
origins, including server-sent-event requests. Pass `--host 0.0.0.0` to opt into phone access and
print the phone-accessible frontend URLs. `PORT` changes the development API port and
`COUCHVIEW_WEB_PORT` changes the Expo/Metro web port.

## Test and verification commands

The canonical submission gate runs the architecture and formatting checks, lint, both TypeScript
configurations, the scoped Bun unit suites, and the production build:

```sh
bun run check:quality
```

To run only the scoped unit suites for scripts, server, shared, and client code, use:

```sh
bun run test
```

For quick local iteration, run only tests reached by uncommitted changes:

```sh
bun run test:changed
```

This is a developer shortcut, not a submission gate. Run `bun run check:quality` before
submitting even when the changed-test run passes.

## Dependency maintenance and runtime profiling

Before updating a dependency, inspect the installed-to-target package diff, including newly added
lifecycle scripts and sensitive runtime imports:

```sh
bun pm diff <package>
```

Audit dependency vulnerabilities without mutating the lockfile. If Bun reports a fix, preview the
exact changes before applying them manually and rerunning the quality gate:

```sh
bun audit
bun audit fix --dry-run
```

Do not run automatic audit fixes in CI. `bun dedupe --check` is useful during explicit lockfile
maintenance, but duplicate transitive versions are not a submission failure unless the dependency
ranges permit a reviewed deduplication. A production dependency license inventory is available with:

```sh
bun pm licenses --prod
```

For a server-side CPU or memory investigation, Bun can produce terminal-readable Markdown profiles
without adding a profiler package:

```sh
bun --cpu-prof-md --cpu-prof-dir /tmp --cpu-prof-name couchview-cpu.md \
	src/server/cli.ts --repo /absolute/path/to/project
bun --heap-prof-md --heap-prof-dir /tmp --heap-prof-name couchview-heap.md \
	src/server/cli.ts --repo /absolute/path/to/project
```

Profiles are diagnostic artifacts and must remain outside the repository.

The optional real speech-contract suite uses an externally installed CouchSpeech distribution. Set
`COUCHSPEECH_INTEGRATION_BIN_DIR` to its distribution or Homebrew `libexec` directory when the
`couchspeech` CLI is not already on `PATH`, then run:

```sh
COUCHVIEW_RUN_SPEECH_MODEL_TEST=1 bun test tests/integration/speech-service.test.ts
```

CouchSpeech's Swift tests, release packaging, lifecycle integration, benchmarks, and profiling are
owned and documented by the standalone CouchSpeech repository rather than Couchview.

Install the browser engines once, then run the mobile and desktop production browser suite:

```sh
bunx playwright install chromium webkit
bun run test:e2e
```

Playwright builds the PWA and starts its deterministic fixture on port 4174. It exercises 320 px, 375 px, and 430 px touch viewports plus compact landscape, multi-project history and tabs, horizontal containment, navigation, search, staging, commits, and PWA behavior. A desktop Chromium project also runs the real Ghostty/WASM renderer against a deterministic terminal WebSocket and verifies lazy renderer and Iosevka loading, input, resize, Review handoff, and tmux session shutdown.

To point the browser suite at an already running instance instead:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 bun run test:e2e
```

## Project layout

- `app/` contains the thin universal Expo Router routes and root layout.
- `src/client/features/` contains stateful product capabilities and side effects.
- `src/client/components/` contains React Native presentation; reusable design-system primitives
  live only in `src/client/components/ui/`.
- `src/client/lib/` contains shared platform services, transport, Jotai wiring, and persistence.
- `src/server/` contains the Bun CLI/server, global SQLite catalog, Git boundary, validation, and
  event streams.
- `src/shared/contracts.ts` is the typed client/server API contract.
- `scripts/dev.ts` supervises the Expo/Metro web and Bun API development processes.
- `scripts/e2e-fixture.ts` serves the deterministic production smoke fixture.

All shipped fonts, icons, scripts, and styles are local. The Expo web postprocessor extracts
inline executable bootstrap code for the existing Content Security Policy and generates the
bounded PWA app-shell service worker without caching API or navigation responses.
