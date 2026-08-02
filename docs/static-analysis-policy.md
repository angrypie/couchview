# Static analysis: direct Biome 2.5, selectively informed by Ultracite

Decision date: 2026-08-01.

## Decision

Couchview uses `@biomejs/biome` 2.5.6 directly. It does not extend Ultracite.
The repository borrows a small set of Ultracite's high-signal correctness and
security choices after checking them against the existing code, while keeping
Couchview's formatter, filename conventions, and architecture thresholds
explicit.

This is intentionally not a rejection of Ultracite as a product. Ultracite
7.9.4 is a mature, AI-oriented preset that supports Biome, ESLint, and the Oxc
toolchain, generates editor/agent configuration, and currently develops
against Biome 2.5.6. It is a strong default for a new codebase that wants its
entire policy. See the [Ultracite project](https://github.com/haydenbleasel/ultracite),
[current package manifest](https://github.com/haydenbleasel/ultracite/blob/main/packages/cli/package.json),
and [agent integration overview](https://www.ultracite.ai/).

Direct Biome is the better path here because the problem being fixed is
repository-specific architecture, not lack of a large generic rule preset.
Biome 2.5 includes more than 500 lint rules, project/module-graph analysis, a
watch mode, concise agent-friendly reporting, and a native
`noExcessiveLinesPerFile` rule. See the [Biome 2.5 release](https://biomejs.dev/blog/biome-v2-5/)
and [file-size rule](https://biomejs.dev/linter/rules/no-excessive-lines-per-file/).

## Why not extend Ultracite wholesale

The current Ultracite Biome core preset deliberately disables
`noExcessiveLinesPerFile` and `noExcessiveLinesPerFunction`, uses cognitive
complexity 20, and leaves `noImportCycles` off unless its type-aware path is
selected. It also requires kebab-case filenames, an 80-column formatter,
non-null-assertion removal, broad key/attribute sorting, and many stylistic
preferences. Its React preset enables exhaustive hook dependencies and
`noLeakedRender`. Those are coherent preset choices, but they are not a
drop-in match for Couchview's current camelCase filenames, established double
quotes, and legacy hooks. The exact sources are
Ultracite's [core Biome preset](https://github.com/haydenbleasel/ultracite/blob/main/packages/cli/config/biome/core/biome.jsonc)
and [React preset](https://github.com/haydenbleasel/ultracite/blob/main/packages/cli/config/biome/react/biome.jsonc).

The trial scan also found that adopting the whole preset immediately would
create large migration noise: exhaustive-dependency and non-null-assertion
diagnostics dominate, while its disabled size rules would not prevent the
specific 6,000-line-file failure.

## Rules adopted now

[`biome.jsonc`](../biome.jsonc) starts from `preset: "none"`, so every
enabled policy is intentional:

- unused imports and variables;
- React hook placement, nested components, JSX keys, children/void-element
  correctness, and prop mutation/duplication;
- button types;
- `eval`, dangerous HTML, debugger statements, loose equality, and duplicate
  JSX props;
- project import-cycle detection;
- direct whole-tree size ceilings plus complexity ceilings for `App.tsx` and
  the extracted `features/`, `components/`, and `lib/` areas;
- deterministic two-space, double-quote, semicolon, trailing-comma, LF, and
  100-column formatting plus import organization.

The React `noLeakedRender` rule was tested and deferred because it produced 36
diagnostics, many on already-boolean JSX conditions and safe object/null
guards. Exhaustive dependencies, non-null assertions, kebab-case filenames,
80-column formatting, automatic key/prop sorting, and the rest of the
Ultracite style layer are also deferred rather than mass-suppressed.

## Architecture checks Biome does not replace

[`scripts/checkArchitecture.ts`](../scripts/checkArchitecture.ts) checks
Couchview-specific import direction and rejects blanket Biome and TypeScript
suppressions. Biome is the sole line-count implementation and applies the same
strict limits to existing and new files; there are no ratchets or size waivers.
The architecture checker's fixture tests cover allowed and forbidden
boundaries plus forbidden suppressions.

Use:

```sh
bun run format
bun run lint
bun run check:architecture
bun run check:quality
```

`format:check` is the formatter/import-organization gate for `App.tsx` and the
new `features/`, `components/`, and `lib/` surface. Full lint and architecture
checks remain mandatory. A whole-tree formatting migration can be scheduled
separately to avoid hiding functional changes in formatting churn.

## AI and agent integration

Ultracite's generated editor files, skills, and hooks are convenience layers;
they do not make analysis itself AI-dependent. Couchview keeps the same useful
workflow locally: deterministic checks run from Codex hooks and CI, while a
repo-local architecture skill tells an agent when to map responsibilities and
review coupling. AI can interpret and repair findings, but Biome and the
architecture checker produce the findings without AI.
