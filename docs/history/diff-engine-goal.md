# Diff engine: remove Pierre, own the tokenizer

- **Status:** Completed historical checklist
- **Owner:** Couchview maintainers
- **Last verified:** 2026-08-22
- **Archived:** 2026-08-22
- **Superseded by:** [Unified diff viewer design](../diff/design.md) and
  [Diff viewer benchmarks](../diff/benchmarks.md)

> This checklist preserves the completion snapshot for the diff-engine replacement. Its test
> counts, benchmark summaries, verification results, and follow-ups are dated evidence—not current
> suite totals or authoritative architecture guidance.

Status legend: `[ ]` pending, `[~]` in progress, `[x]` done.

## Phase 0 — Delete Pierre
- [x] Replace `parsePatchFiles`: build the row model directly from the server contract hunks for compact/partial diffs
- [x] Write own unified-patch parser for `fullFilePatch` (git output only)
- [x] Replace `getSharedHighlighter` with direct `createHighlighterCore` + `@shikijs/engine-javascript`
- [x] Own language detection map (extension -> shiki lang, unknown -> text)
- [x] Vendor Pierre theme JSONs into `engine/themes/` with Apache-2.0 attribution
- [x] Delete `pierre.ts` / `pierre.native.ts`; drop `@pierre/diffs`, `@pierre/theme`, `@pierre/theming` deps

## Phase 1 — Own the tokenizer
- [x] Write `LineTokenizer` (replaces `ShikiStreamTokenizer`): streaming, cancellable
- [x] Checkpoint grammar state every K lines; resume from nearest checkpoint behind a window
- [x] Resume mid-interval fills from exact state; snapshot/restore for LRU sessions
- [x] Cache checkpoint states + tokenizer session per (repo, file, revision, theme) in the LRU

## Phase 2 — Loading + engine tuning
- [x] Grammar-on-demand: lazy dynamic imports from `@shikijs/langs` subpaths; unknown -> text
- [x] Warmup tokenization per grammar load (avoids JS-engine time-limit truncation on cold calls)
- [x] WASM Oniguruma engine on web only; JS engine on native (shikiEngine platform seam)

## Phase 3 — Degradation cap
- [x] Above `plainContextThreshold` rows: context rows render plain; changed lines keep syntax colors

## Verification
- [x] Golden snapshot tests: fixture gauntlet (TSX, Python, shell heredocs) + `golden-snapshots.json`
- [x] JS-engine host regression: explicit JS-engine highlighter runs the gauntlet through
      `tokenizeRowsWithHighlighter`, char-level color parity vs the golden (both engines covered)
- [x] Engine tests: 41 pass (rows, adapt, parse, metrics, palette, tokens, tokenizer, golden)
- [x] `bun run check:quality` green (incl. production web build)
- [x] Full unit suite: 552 tests pass
- [x] Playwright: mobile-smoke 9/9 pass, desktop-layout 4/4 pass
- [x] iOS agent-device: new engine loads on Hermes, tokens verified hue-identical to golden,
      row backgrounds pixel-identical to web, hunk nav + identifier tap + line-number toggle work
- [x] [`docs/diff/benchmarks.md`](../diff/benchmarks.md) written with before/after numbers
  (WASM web 7.5-13x; native checkpoint resume up to 10x)
- [x] [`docs/diff/design.md`](../diff/design.md) updated (Decisions 2, 4, 4b-4d,
  verification)
- [x] [`ARCHITECTURE.md`](../../ARCHITECTURE.md) dependency note updated

## Notes / follow-ups
- `Light` theme on iOS not re-verified visually after the rewrite (settings sheet keeps
  opening the RN dev menu under agent-device). Light uses the identical pipeline and the
  vendored pierre-light JSON; web light/dark covered by the e2e theme spec.
- Wrap toggle on iOS could not be flipped through agent-device: gluestack `IconButton`s
  report `hittable: false` to the accessibility tree and agent-device's fallback opens the
  RN dev menu. A real finger tap works (the toggle path is geometry-only and untouched by
  this task; web toggle verified via e2e + probes). Pre-existing agent interaction quirk.
- `DIFF_BENCH_ENGINE=js` env switch in `shikiEngine.ts` exists so the bench can measure
  the native engine on the host.
