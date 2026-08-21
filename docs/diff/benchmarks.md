# Diff viewer benchmarks

- **Status:** Current benchmark record
- **Owner:** Couchview maintainers
- **Last verified:** 2026-08-22
- **Superseded by:** —

This document records the current shared Legend List surface and owned token
engine. Canvas-tile and retained-iOS-image measurements belonged to deleted
renderers and are not acceptance evidence for the current architecture.

## Token engine

Run the web/WASM engine with:

```sh
bun run scripts/diffBench.ts
```

Run Shiki's JavaScript fallback with:

```sh
DIFF_BENCH_ENGINE=js bun run scripts/diffBench.ts
```

The deterministic fixture uses realistic TS/TSX at 600 and 5,000 source
lines, a dark theme, on-demand grammar loading, 64-line checkpoints, and the
production degradation threshold. These results were captured on 2026-08-20
with Bun 1.3.14 on a Mac16,11 / Apple M4 Pro:

| Scenario | Web Oniguruma WASM | JavaScript fallback |
|---|---:|---:|
| Cold initialization + first 600 lines | 322 ms | 1,572 ms |
| Warm 600 lines | 213 ms | 516 ms |
| 5,000-line walk | 1,925 ms | 4,316 ms |
| Resume after 500 of 5,000 | 1,728 ms | 3,868 ms |
| Resume after 4,500 of 5,000 | **176 ms** | **414 ms** |
| Re-walk 5,000 without resume | 1,915 ms | 4,318 ms |
| Store 600-line cache entry | 228 ms | 515 ms |
| Complete cache hit | **0 ms** | **0 ms** |

The 5,000-line metric retains detailed runs for 714 rows because production
degrades unchanged context above the configured threshold while still walking
the grammar state. The deep-resume result is the important navigation bound:
checkpoint reuse avoids replaying the first 4,500 lines.

Native production normally uses the Nitro Oniguruma bridge, not the JavaScript
fallback. The fallback column remains useful as the worst supported development
configuration when a build does not contain the native module. Nitro/WASM byte
parity is covered separately by `scripts/nitroOnigParity.test.ts`.

## Production web scroll methodology

`scripts/diffScrollBenchmark.ts` measures the built Couchview app, not an
isolated list demo. It:

- serves the production PWA beside the deterministic API fixture;
- launches headed hardware-accelerated Chromium at 1,280 × 800 and DPR 2;
- waits for the expected logical row count, complete tokens, and mutation
  quiet;
- drives one-way and four-leg touch scrolls through CDP at 50,000 px/s;
- records logical rows and mounted semantic `[data-line]` elements separately;
- sums macOS `proc_pid_rusage` deltas for Chromium and its renderer/GPU/helper
  descendants; and
- reports CDP main-thread task/script utilization over the same wall window.

CPU is cumulative user + system time divided by wall time, where 100% is one
host logical core. Power is process-attributed `ri_energy_nj` divided by wall
seconds. It is a same-host regression signal, not wall-plug power or predicted
physical-device battery use.

Run the accepted endpoint cohorts with:

```sh
bun run benchmark:diff-scroll:verify
```

The command builds once, performs one warmup and five measured pairs at 250
and 5,000 source lines, enforces the row-specific budgets, and writes the full,
machine-specific samples outside the repository to:

- `/tmp/couchview-diff-scroll-baseline-250.json`
- `/tmp/couchview-diff-scroll-baseline-5000.json`

These reports include host and process diagnostics and are not commit candidates.
For optimization candidates, keep the accepted local reports unchanged. Write
each new five-sample run to a distinct path, then use the read-only strict comparison:

```sh
bun run benchmark:diff-scroll --dist dist --lines 250 --warmups 1 --samples 5 \
  --output /tmp/couchview-diff-scroll-candidate-250.json
bun run benchmark:diff-scroll:compare \
  --baseline /tmp/couchview-diff-scroll-baseline-250.json \
  --candidate /tmp/couchview-diff-scroll-candidate-250.json
```

Repeat with `--lines 5000` and a distinct candidate path. Candidate capture is
the same headed, focus-disrupting benchmark described above; comparison itself
only reads the two JSON reports and opens no browser. It rejects anything other
than five clean samples per scenario, exact workload and environment identity,
and strictly lower raw-sample median CPU and power for both scenarios. Chromium's
three per-launch GPU timing/counter fields are excluded from environment identity.

## Direct-DOM Legend surface results

The following five-sample medians were captured on Chromium 149.0.7827.55,
macOS 26.5.2, and the Mac16,11 / Apple M4 Pro used above on 2026-08-21:

| Source lines | Workload | CPU | Power | Footprint | Wall | Chrome task | Script | Mounted / logical rows |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 250 | one-way | 23.2% | 0.362 W | 715 MB | 371 ms | 9.0% | 5.7% | 59 / 251 |
| 250 | four legs | 29.3% | 0.317 W | 671 MB | 1,310 ms | 11.0% | 6.4% | 67 / 251 |
| 5,000 | one-way | 46.2% | 0.641 W | 768 MB | 2,009 ms | 21.3% | 11.0% | 59 / 5,001 |
| 5,000 | four legs | 38.1% | 0.482 W | 754 MB | 7,880 ms | 20.1% | 10.6% | 67 / 5,001 |

The web surface keeps Legend List's range ownership and full semantic token
rows, but renders each recycled row directly with browser DOM elements instead
of rebuilding it through React Native Web's host-prop and style conversion.
Token spans retain stable positions while their text, colors, identifier roles,
and handlers are rebound. Legend's fixed-size web path also advances its normal
measurement bookkeeping from known row geometry without forcing a DOM rectangle
read for each recycled container. Native continues to use the React Native
`View`/`Text`/SVG implementation.

The strict raw-report comparison against the previous React Native Web row
baseline passed all eight required CPU and power cells:

| Source lines | Workload | CPU before | CPU now | CPU change | Power before | Power now | Power change |
|---:|---|---:|---:|---:|---:|---:|---:|
| 250 | one-way | 28.631% | 23.176% | −19.1% | 0.733674 W | 0.361681 W | −50.7% |
| 250 | four legs | 41.317% | 29.254% | −29.2% | 0.561649 W | 0.316821 W | −43.6% |
| 5,000 | one-way | 49.257% | 46.185% | −6.2% | 0.983559 W | 0.640924 W | −34.8% |
| 5,000 | four legs | 38.903% | 38.099% | −2.1% | 0.729899 W | 0.481635 W | −34.0% |

The mounted envelope is constant across a 20× logical-size increase. That is
the primary virtualization invariant: the production surface does not mount a
full semantic document, and progressive tokens do not replace the list.

Three-sample empty-scroller controls used the same browser, dimensions,
gesture, process accounting, and logical heights:

| Source lines | Workload | CPU | Power | Chrome task | Script |
|---:|---|---:|---:|---:|---:|
| 250 | one-way | 5.8% | 0.022 W | 0.6% | 0.0% |
| 250 | four legs | 7.9% | 0.008 W | 1.0% | 0.0% |
| 5,000 | one-way | 11.1% | 0.011 W | 1.6% | 0.0% |
| 5,000 | four legs | 11.5% | 0.006 W | 1.6% | 0.0% |

Those controls establish that the remaining delta is real Legend/semantic-row
work, not the host gesture or process sampler. The current renderer retains
normal text selection, per-identifier accessibility, syntax colors during the
gesture, and one bounded virtualized surface without canvas backing.

The current median gates include measured variance without hiding the row-size
difference:

| Source lines | Maximum median CPU | Maximum median power |
|---:|---:|---:|
| 250 | 45% | 0.9 W |
| 5,000 | 55% | 1.1 W |

These absolute thresholds are operational ceilings, not evidence that one
candidate beats another. Optimization acceptance uses the strict raw-report
comparison above. Do not compare either signal across machines; retain raw
artifacts and compare adjacent runs on the same host/browser.

## Browser behavior proof

`tests/e2e/diff-scroll-desktop-layout.spec.ts` crosses the real production
boundary and asserts:

- exact fixed row and total content geometry at 250 lines;
- selectable semantic text and accessible identifier activation;
- identifier semantics and non-default syntax colors during an active CDP touch
  gesture, before scroll settling;
- no canvas elements;
- hunk navigation plus a later user-scroll visible-line report;
- unchanged completed token revision while scrolling; and
- bounded mounting, middle jumps, exact bottom reach at 5,000 lines, and zero
  recycled-row `getBoundingClientRect` reads after initial readiness.

The mobile Playwright suite separately exercises wrapping, font size, line
number controls, and typography on the React Native Web build.

## Native evidence

iOS acceptance used a fresh Release simulator build on 2026-08-20, the same
Mac16,11 host, and an iOS 26.5 iPhone simulator. Both deterministic Git fixtures
were registered with the already-running Couchview server and opened through
the production deep-link path.

The 250-line run verified tokenized identifier accessibility, three hunk
positions including the final changed row, disabled endpoint navigation, an
identifier opening **Find in project** with the query prefilled, and the native
text-selection **Copy** menu. The settled app used 452,496 KiB resident memory
and 0.7% CPU.

The 5,000-line run began at 443,632 KiB resident memory and 0.7% idle CPU. Its
accessibility snapshot contained 133 total nodes at the top—not 5,000 rows.
After jumps to line 2,501 and line 4,998, two reverse-and-forward repeat cycles,
and completed token work, the app used 525,552 KiB and 0.7% idle CPU. The final
snapshot contained 199 total nodes and exposed lines 4,975–5,000 plus the fixed
review controls. This is an 80 MiB resident increase across full-range
navigation and token completion while the mounted accessibility envelope
remained bounded.

`agent-device perf frames` does not provide frame-health sampling for iOS
simulators, so this run makes no native FPS or dropped-frame claim. CPU values
are post-settle process snapshots, not interaction-window averages. The native
evidence therefore establishes functional parity, endpoint reach, bounded
mounting, and resident-memory behavior; the production web benchmark above is
the quantitative interaction-window CPU/power gate.

The web-only row specialization was also exported for iOS without launching a
simulator. Hermes bytecode contains the generic React Native `View`, `Text`, and
SVG row implementation and excludes the web-only DOM token/separator functions,
proving the platform-specific import does not alter the native renderer.
