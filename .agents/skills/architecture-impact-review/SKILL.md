---
name: architecture-impact-review
description: >-
  Plan and verify Couchview feature or refactor work that touches an oversized
  hotspot, adds UI state, effects, mutations, or streams, crosses feature
  boundaries, changes three or more production modules, or affects React
  Native Web portability. Produce a responsibility map before edits and run
  the architecture gate before completion.
---

# Architecture impact review

1. Read `AGENTS.md` and `ARCHITECTURE.md`, then run
   `bun run check:architecture` to establish the baseline.
2. Before editing, list each responsibility being added or moved, its owning
   feature or component, its state owner, side effects, platform-specific APIs,
   dependencies, and tests.
3. Keep `src/client/App.tsx` as wiring only. Put extracted client code strictly
   in `features/`, `components/`, or `lib/` according to the ownership map.
4. For every touched legacy hotspot, identify the responsibility to extract.
   Do not grow a ratchet, code-golf around a limit, or split files without
   reducing coupling.
5. Implement through behavior-preserving seams. Run focused tests after each
   extraction or state-ownership change.
6. Inspect the final diff for responsibility drift, platform leakage, cycles,
   new hook/state concentration, and policy-file changes.
7. Run `bun run check:quality` and relevant Playwright tests. Repair failures;
   never change limits, exclusions, suppressions, checker logic, or CI merely
   to make the product patch pass.
8. Report the responsibility moves and architecture result with the functional
   verification.
