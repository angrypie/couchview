# Agentic Engineering Maintainability

## Why Couchview produced a 5,395-line `App.tsx`, and how to prevent a recurrence

- **Date:** 2026-08-01
- **Repository snapshot:** `4ea9b91` (`main`)
- **Scope:** Couchview evidence, current GPT-5.6/Codex guidance, and primary research on repository-level coding agents
- **Decision requested:** whether to rely on prompts, `AGENTS.md`, a skill, hooks, review, or hard tooling to obtain consistently maintainable changes

## Implementation update (2026-08-02)

The repository facts and growth timeline below describe snapshot `4ea9b91` and
remain the historical diagnosis. The first prevention and remediation pass is
now implemented:

- `src/client/App.tsx` has been reduced from 5,395 lines to 189 lines and
  is mechanically restricted to composing `features/`, `components/`, and
  `lib/` modules.
- Stateful workflows were moved by responsibility into feature hooks; screen
  and overlay markup was moved into presentation components; small generic
  browser helpers were moved into `lib/`.
- Couchview adopted direct `@biomejs/biome` 2.5.6, informed by selected
  Ultracite 7.9.4 rules rather than extending Ultracite's complete policy.
  The rationale and trial results are recorded in
  [`static-analysis-policy.md`](static-analysis-policy.md).
- Biome now solely enforces strict file and function line limits for the whole
  tree. The architecture checker owns import direction and suppression policy;
  local Codex hooks, a repo-local architecture skill, ownership rules, and a
  GitHub quality workflow make those expectations machine-visible.
- The temporary baseline mechanism described in the original proposal below
  was retired after the oversized files were split. There are no legacy size
  exceptions or separate line-count implementation.

Branch protection, required CODEOWNER approval, repeated historical-task
evaluation, and independent semantic review still require repository-level or
human activation. The implementation therefore provides deterministic local
and CI checks, but it does not by itself establish the conditional merge
guarantee described in Section 4.

## Executive conclusion

The 5,395-line [`src/client/App.tsx`](../src/client/App.tsx#L626) is not evidence that GPT-5.6 lacks knowledge of component decomposition. It is evidence that the engineering system made locally successful, architecturally harmful behavior the easiest behavior to repeat.

The decisive facts are:

1. `App.tsx` was already 2,124 lines in the initial commit. The repository therefore taught every later agent that the root component was the normal home for application behavior.
2. Feature work was evaluated by visible behavior, tests, type checking, and build success. None of those checks measured responsibility placement, component size, coupling, or hotspot growth.
3. The root component already owned the state and coordination needed by each next feature. Adding another state variable, callback, effect, or JSX branch there was usually the smallest and safest patch for the immediate task.
4. Couchview had no linter, architecture checker, CI workflow, protected branch, ruleset, or no-growth policy. There was no machine-visible failure when the file crossed 3,000, 4,000, or 5,000 lines.
5. `AGENTS.md` contained detailed behavioral and performance requirements but no client responsibility map or composition-root invariant. In particular, its cache, prefetch, optimistic-update, and reconciliation requirements are valuable, but it did not say where that coordination should live.
6. The same size pattern appears in the server. This is a repository-wide feedback problem, not one accidental React component.

The proper remedy is not a sentence such as “do not write 6,000-line files.” GPT-5.6 already has that generic knowledge, and prose remains a probabilistic influence. The proper remedy is a layered control system:

- Put concise, Couchview-specific architectural invariants in `AGENTS.md`.
- Put the repeatable planning and final-audit workflow in a repo-local skill.
- Put measurable limits and dependency boundaries in executable checks.
- Run fast checks from Codex hooks so the agent receives feedback while it can still repair the patch.
- Run the same checks in CI and make them required on a protected `main` branch with bypass disabled.
- Use an independent architecture review for qualities that cannot be reduced to a number.
- Evaluate the complete setup on reconstructed historical tasks and multiple runs instead of assuming that more prompt text helps.

This yields two different assurance levels that must not be confused:

- **A hard, conditional guarantee is possible:** no commit that violates a correctly implemented mechanical policy can enter protected `main`, assuming all merge paths require the check and nobody can bypass it.
- **A universal guarantee of “good architecture” or “middle-level engineer behavior” is impossible:** maintainability is partly semantic, requirements are incomplete, checks are proxies, model outputs are probabilistic, and authorized humans can change or bypass policy.

For Couchview, my recommendation is therefore **yes to a small `AGENTS.md` amendment, yes to a focused architecture-impact skill, yes to Codex hooks, and mandatory CI/branch enforcement**. `AGENTS.md` or a skill alone would not satisfy the requested certainty.

## 1. What can be established with certainty

### 1.1 Repository facts

These observations come directly from the current tree and Git history:

| Observation | Evidence | Confidence |
|---|---|---:|
| `App.tsx` is 5,395 physical lines | `wc -l src/client/App.tsx` | Certain |
| The exported `App` function spans lines 626–5,395, about 4,770 lines | Current source | Certain |
| Within that function, the source contains 68 `useState`, 20 `useEffect`, 62 `useCallback`, 10 `useMemo`, and 27 `useRef` occurrences | Current-source scan scoped to the function | Certain as a lexical count |
| `App.tsx` is 34.1% of the 15,829 non-test, non-asset client source lines | Current-source inventory | Certain |
| `App.tsx` plus the 3,682-line `styles.css` is 57.3% of that client source | Current-source inventory | Certain |
| The initial commit already contained a 2,124-line `App.tsx` | Git object `ccd0040` | Certain |
| Seventeen commits touched `App.tsx`; its net size increased by 3,271 lines | Git history | Certain |
| Several server files are also over 1,000 lines; the largest is `repository.ts` at 2,313 | Current-source inventory | Certain |
| `package.json` defines build, typecheck, unit-test, and E2E commands but no lint or architecture command | [`package.json`](../package.json) | Certain |
| No project `.github`, `.codex`, or `.agents` enforcement configuration exists in the current tree | Current tree | Certain |
| GitHub reported `main` as unprotected and returned no repository rulesets on 2026-08-01 | GitHub API, read-only inspection | Certain for the inspection time |

The component is not merely long rendering code. It coordinates repository bootstrap and selection, diff fetching and caching, prefetch, review state, comments, staging, commits, package commands and run streams, search, source preview, settings persistence, PWA/restart behavior, keyboard commands, browser history, drawers, sheets, dialogs, notifications, and error recovery. Some leaf components have been extracted, but the ownership and orchestration remained concentrated in `App`.

### 1.2 Growth timeline

The important feature of the history is not the final line count; it is the absence of a point at which growth became a failing condition.

| Commit | Date | `App.tsx` lines | Relevant change |
|---|---:|---:|---|
| `ccd0040` | 2026-07-21 | 2,124 | Initial repository |
| `9336418` | 2026-07-22 | 2,175 | Review workflow and staging controls |
| `f95ab4f` | 2026-07-23 | 3,082 | Review workflow and mobile UI |
| `c2a1a87` | 2026-07-23 | 3,851 | More review workflow and mobile UI |
| `a09dc50` | 2026-07-23 | 4,520 | Auto restart |
| `af33321` | 2026-07-26 | 4,714 | Repository review and staging workflows |
| `ee35dce` | 2026-07-26 | 4,643 | Terminal extraction reduced the file slightly |
| `a6f9844` | 2026-07-28 | 4,813 | Performance and settings |
| `0522c66` | 2026-07-31 | 4,885 | SSH bridge and PWA updates |
| `f00f568` | 2026-07-31 | 5,377 | Review workflow and repository navigation |
| `4ea9b91` | 2026-08-01 | 5,395 | Addition/deletion totals |

Two commits on 2026-07-23 added a net 907 and 769 lines respectively. By the end of the third calendar day, the component was already 4,520 lines. Later extraction work demonstrated that the model could create components, but it did not reverse the central ownership model.

This diagnosis is an explanation, not an excuse. Continuing to add feature orchestration to an already 2,124-line root was an engineering failure. I should have identified the composition root as a hotspot in the initial change, and certainly before the first roughly 900-line expansion; proposed a responsibility map; extracted the touched workflow; and made structural verification part of done. A competent mid-level engineer is expected to surface that tradeoff rather than silently preserve the shortest patch. The prevention system in this report is intended to make that judgment explicit, observable, and enforceable instead of depending on me to rediscover it each time.

### 1.3 What the evidence cannot establish

The repository does not contain the exact user prompts, agent transcripts, hidden reasoning, model sampling state, or model-training corpus. Therefore:

- It is not possible to prove the precise internal reason for any one edit.
- It is not possible to attribute the outcome to a specific category of training data.
- It is not possible to prove that every commit used exactly the same model or instruction stack from Git alone.
- It would be misleading to claim a direct empirical result about GPT-5.6 specifically when a cited study evaluated earlier or different models.

The causal analysis below is consequently divided into direct evidence and the best-supported inference. The overall diagnosis is high confidence because several independent mechanisms point in the same direction, but it is not a transcript-level reconstruction.

## 2. Why an agent that “knows” clean architecture still does this

### 2.1 Knowledge is not the active objective

An agent can know that god components are undesirable while still choosing one more local addition. At implementation time, it is optimizing a concrete task under the feedback it can observe:

- Does the feature work?
- Do tests pass?
- Does TypeScript compile?
- Did the build succeed?
- Did the patch avoid breaking fragile interactions?
- Was the requested change completed without expanding scope?

Before this report, “Did responsibility move into the correct module?” and “Did a hotspot grow?” produced no comparable signal. Functional checks were executable and immediate; maintainability was implicit and silent.

This is visible in common coding-agent evaluations as well. The SWE-bench harness applies a generated patch and runs repository tests to decide whether an issue is resolved; its headline metrics are resolution counts and rates, not long-term maintainability ([SWE-bench evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/)). The original benchmark correctly emphasizes multi-file coordination and long context, but its success mechanism is still issue resolution ([SWE-bench paper](https://arxiv.org/abs/2310.06770)). This does not prove how GPT-5.6 was trained, but it illustrates the broader measurement asymmetry: functional success is easier to score than architectural quality.

OpenAI's July 2026 audit also found that roughly 30% of the inspected SWE-Bench Pro tasks were broken, including low-coverage tests that allowed incomplete fixes to pass. Its audit used repeated agents plus experienced engineers, and human reviewers found more problems than the agent pipeline ([OpenAI evaluation audit](https://openai.com/index/separating-signal-from-noise-coding-evaluations/)). Tests are essential, but neither a green test suite nor a benchmark score is a complete engineering-quality oracle.

### 2.2 The repository created architectural gravity

Once a root component owns repository state, network calls, mutation queues, overlays, and navigation, the next feature often genuinely needs access to several of them. The shortest change is then to add the feature in the same component. Each addition increases the cost and risk of later extraction, which makes the same choice even more attractive next time.

This is a path-dependent loop:

1. The root owns the existing state.
2. A new feature needs that state.
3. Adding locally is the smallest behavior-preserving patch.
4. The root gains another responsibility and more coupling.
5. Extraction becomes larger and riskier.
6. The next local addition becomes still more attractive.

The initial 2,124-line file mattered enormously. Models infer conventions from the code they inspect. In Couchview, the strongest nearby example said “application behavior belongs here.” A generic prior about modularity had to compete with concrete local evidence and an immediate regression risk.

### 2.3 Scope conservatism discouraged the necessary refactor

A feature request normally authorizes the feature, not an open-ended architectural rewrite. Refactoring a central component changes many lines, creates temporary risk, and can appear unrelated to the visible acceptance criteria. A cautious agent may therefore avoid it, especially when instructions emphasize preserving behavior and keeping changes focused.

That instinct is useful for a small bug fix. It becomes harmful when the code has crossed a structural threshold and the only responsible way to add a feature is to extract the touched responsibility first. Couchview had no durable rule establishing that such extraction was part of the authorized feature scope. The agent was never forced to resolve the conflict between “keep the patch focused” and “do not deepen the monolith.”

### 2.4 The instruction set specified behavior, not ownership

The existing [`AGENTS.md`](../AGENTS.md) is useful but unevenly specific:

- It precisely defines commands, style, testing, server lifecycle, and security constraints.
- It gives unusually detailed performance guidance on caching, revisions, prefetch, optimistic updates, reconciliation, and mobile memory.
- It only says that `src/client/` holds the React UI and that client/server boundaries should remain explicit.
- It does not say what `App.tsx` may own, how feature modules are divided, where browser adapters belong, or when extraction is required.
- It says no formatter or linter is configured, and no architecture command appears in the completion checklist.
- Its statement that history contains only `init` is already stale, showing that durable instructions also need maintenance.

The performance guidance did not cause the monolith, but it created sophisticated cross-cutting requirements without a placement rule. The established root component was the obvious place to coordinate them.

### 2.5 Passing tests became a false definition of done

The current `App.test.tsx` is itself 2,668 lines. Those tests can provide strong behavioral protection while the production design deteriorates. That is not a contradiction: tests answer whether observed behavior matches expectations, not whether responsibilities are coherently placed.

Research on LLM-generated code increasingly separates these dimensions. A 2026 Journal of Systems and Software study combined a 109-paper review, industry workshops, and empirical patch generation; practitioners prioritized maintainability and readability, while prompt-based optimization of non-functional quality was unstable ([quality-assurance study](https://arxiv.org/abs/2511.10271)). A separate code-smell benchmark explicitly argues that correctness-centered benchmarks under-assess generated-code quality, although its case study used CodeLlama and Mistral rather than GPT-5.6 ([CodeSmellEval](https://arxiv.org/abs/2412.18989)). These studies support the measurement problem; they should not be read as a direct performance estimate for the current model.

### 2.6 Long-horizon work magnifies local mistakes

Repository work requires maintaining a responsibility map and change-impact model across many edits. CodePlan framed repository-level coding as a planning problem and combined dependency analysis, change-impact analysis, and adaptive planning. In its evaluated migrations, it passed validity checks on five of six repositories while baselines without planning passed none ([CodePlan](https://arxiv.org/abs/2309.12499)). That result is narrow and predates GPT-5.6, but the mechanism is directly relevant: local code completion is not the same as maintaining a repository-wide plan.

The general long-context literature also finds that models do not use every part of a large context equally reliably; information position can materially affect retrieval ([Lost in the Middle](https://arxiv.org/abs/2307.03172)). This study used older models and non-coding tasks, so it is supporting evidence rather than a measurement of GPT-5.6. The practical lesson remains sound: architecture cannot depend on one sentence surviving a long transcript, a 5,000-line file, repeated tool output, and context compaction.

METR's current time-horizon framework defines task length probabilistically—the human time for tasks an agent completes with 50% success—rather than declaring frontier agents uniformly reliable ([time-horizon paper](https://arxiv.org/abs/2503.14499)). A February 2026 comparison found that the tested GPT-5 Codex scaffold did not significantly outperform METR's default scaffold on that suite, despite more elaborate task-management prompting ([METR scaffold comparison](https://metr.org/notes/2026-02-13-measuring-time-horizon-using-claude-code-and-codex/)). Neither result directly measures GPT-5.6 or React architecture. Both caution against treating model size, a TODO list, or a sophisticated wrapper as a certainty mechanism.

### 2.7 Self-review shares the original blind spot

Asking the same agent to “review your work” is helpful but is not an independent detector. If the agent treated local placement as normal during implementation, it may apply the same frame during review.

Research outside coding makes this limitation explicit. An ICLR 2024 study found that intrinsic self-correction without external feedback often failed and could reduce reasoning accuracy ([Huang et al.](https://proceedings.iclr.cc/paper_files/paper/2024/hash/8b4add8b0aa8749d80a34ca5d941c355-Abstract-Conference.html)). ACL 2024 work separated error detection from correction and found that models corrected known mistakes much better when given the mistake location; finding the mistake was the bottleneck ([Tyen et al.](https://aclanthology.org/2024.findings-acl.826/)). Those are reasoning experiments, not GPT-5.6 code-maintainability trials, but their implication matches software-engineering evidence: give the model an external detector.

A software-specific study did exactly that with tests and static analysis. Its evaluated open-source models were poor at detecting their own C-code errors and vulnerabilities but substantially better at fixing them after receiving external reports ([Dolcetti et al.](https://arxiv.org/abs/2412.14841)). This is the strongest rationale for a checker-plus-repair loop: do not merely ask the agent to remember quality; make violations observable and actionable.

### 2.8 The training-data explanation is unknowable and not actionable

It is plausible that public code contains both excellent architecture and enormous legacy files. It is also plausible that local repository patterns dominate abstract style guidance during a task. But OpenAI's proprietary training mixture and the causal contribution of any examples are not available here.

“The model saw too much bad code” is therefore not an evidence-backed root cause. Even a model trained only on exemplary code would still face ambiguous requirements, local conventions, regression risk, incomplete tests, and a missing maintainability objective. The actionable variables are the context, task contract, tool feedback, repository structure, review process, and merge controls.

## 3. Why a bigger model is not the missing control

Current OpenAI guidance says GPT-5.6 performs best on coding work when roles, workflow, testing, patch validation, modularity, file/folder structure, component reuse, and backend-call separation are made explicit. For long-running tasks, it recommends planning and progress tracking ([GPT-5.6 coding guidance](https://developers.openai.com/api/docs/guides/prompt-engineering#coding)). This confirms that the model is steerable; it does not claim architectural infallibility.

The same current guidance recommends lean prompts, stating each rule once, and validating prompt changes on representative evaluations. OpenAI reports directional internal gains from removing repeated prompt material, not from continuously adding generic commandments ([GPT-5.6 prompting best practices](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)). Therefore, adding pages of “act like a senior engineer,” SOLID summaries, and arbitrary examples to every run can consume context without creating enforcement.

Model capability and engineering assurance solve different problems:

| Question | Best lever |
|---|---|
| Can the model understand and execute a good decomposition? | Strong model, sufficient reasoning, clear context |
| Will it notice that this particular task needs decomposition? | Architecture map, change-impact workflow, focused review |
| Will it repair a detected violation? | Fast, precise external feedback |
| Can a prohibited structure enter `main`? | Deterministic CI check plus protected branch |
| Is the resulting design genuinely coherent? | Independent semantic review and repository-specific evals |

GPT-5.6 should remain the implementation model when quality matters, but “use the biggest model” is a probability improvement, not a substitute for an engineering process.

## 4. The exact meaning of “100% certainty”

### 4.1 What can be guaranteed

For a deterministic predicate `architecture_check(commit)`, the repository can enforce:

> Every commit admitted to protected `main` has an `architecture_check` result of pass.

That statement can be made effectively certain if all of the following are true:

1. The check correctly covers every relevant source path and rejects malformed or missing policy.
2. The CI job runs against the exact commit to be merged.
3. The check is a required status check.
4. Direct pushes and force pushes cannot bypass the rule.
5. Administrators and automation cannot bypass it, or bypasses are separately governed and audited.
6. The policy file, waiver file, checker, and workflow cannot be casually weakened in the same patch—ideally they require owner approval.
7. The CI platform and repository host operate as specified.

GitHub supports required status checks, required reviews, restrictions on direct changes, and an option not to allow bypassing branch protection ([GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)). Couchview currently enables none of these controls.

Under those assumptions, a 6,000-line `App.tsx` can be prohibited from reaching `main`. This is a guarantee about a measurable repository state, not about the agent's mind.

### 4.2 What cannot be guaranteed

No prompt, model, skill, linter, or review process can prove the universal statement:

> Every merged design is maintainable and reflects at least middle-level engineering judgment.

Reasons include:

- “Maintainable” is not a complete decidable predicate.
- Line count and cyclomatic complexity are imperfect proxies.
- An agent can split one god component into twenty incoherent files.
- It can move coupling behind poorly named hooks or contexts.
- It can preserve file limits while introducing leaky dependencies.
- A requirement can genuinely justify a larger module.
- A policy can be wrong, stale, or intentionally waived.
- Humans and administrators retain authority to change the system.

The honest objective is therefore: **guarantee selected invariants, make semantic failures substantially less likely, detect them earlier, and measure the residual failure rate.** Claiming more would be false certainty.

## 5. Which control belongs where

OpenAI's own current documentation supports a division of labor. `AGENTS.md` supplies persistent repository expectations; skills package reusable workflows and optional scripts; hooks can run validation during the agent loop; deterministic mechanics belong in tests or linters; code review remains an additional reviewer rather than hard enforcement ([AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [skills guidance](https://learn.chatgpt.com/docs/build-skills), [hooks guidance](https://learn.chatgpt.com/docs/hooks), [custom review rules](https://developers.openai.com/blog/custom-code-review-rules-for-codex)).

| Control surface | Put here | Do not rely on it for | Assurance |
|---|---|---|---|
| Task prompt | Outcome, task-specific constraints, acceptance criteria | Durable repo memory | One-run, probabilistic |
| `ARCHITECTURE.md` | Responsibility map, dependency direction, platform boundaries, rationale | Automatic compliance | Durable reference |
| `AGENTS.md` | Short repo-specific invariants, required commands, no-waiver rule | Every numeric/mechanical detail | Persistent steering |
| Repo-local skill | Change-impact plan, extraction workflow, final architecture audit | Blocking an invalid merge | Repeatable workflow |
| Codex `PostToolUse`/`Stop` hooks | Fast architecture report and repair feedback | Irreversible enforcement | Immediate feedback; locally bypassable |
| Static checker/linter | Strict file/function ceilings, import boundaries, cycles | Cohesion, naming, good abstraction | Deterministic for encoded rules |
| Independent review | Responsibility placement, coupling, needless abstraction, policy gaming | Literal certainty | Semantic, probabilistic |
| CI + protected branch | Execute checks on the merge commit and reject failures | Determining whether the policy itself is wise | Hard gate under stated assumptions |
| Repo-specific eval suite | Measure prompt/skill/checker effectiveness and variance | Proving future universal behavior | Empirical confidence |

OpenAI reported that concise custom repository review rules recovered 98% of required findings in its primary internal suite versus 58.3% for the baseline. That is strong evidence that scoped rules help, but it is still an eval result about review, not a 100% generation guarantee. The same guidance recommends keeping mechanical checks in CI and using rules for non-obvious judgment ([custom review rules](https://developers.openai.com/blog/custom-code-review-rules-for-codex)).

## 6. Recommended Couchview prevention system

### 6.1 Establish an explicit architecture target

Create `ARCHITECTURE.md` as the authoritative responsibility map. It should be short enough to use and specific enough to answer “where does this state or side effect belong?”

For the current web client, a sensible target is:

- `app/`: composition, top-level routing, providers, and application-wide lifecycle only.
- `features/repositories/`: repository selection and repository-session state.
- `features/review/`: file navigation, diff loading/prefetch, review state, and review screens.
- `features/staging/`: stage/unstage/bulk/commit use cases and reconciliation.
- `features/comments/`: comment state, editing, jumps, export, and Codex review integration.
- `features/packages/`: package scripts, run streams, snapshots, and UI.
- `features/settings/`: profiles, persistence queue, typography, and settings screens.
- `platform/web/`: `window`, browser history, service workers/PWA, `EventSource`, clipboard, and web-only terminal adapters.
- `shared` or a future `core/`: platform-independent contracts, reducers, selectors, and use cases.

The implemented first pass follows the user's stricter three-way client split:
`App.tsx` remains the composition root, while extracted code lives only in
`features/`, `components/`, or `lib/`. A separate `app/` or `platform/web/`
layer should be introduced only when it carries a real second target or adapter
boundary, not as another organizational wrapper.

The target for `App.tsx` is a small composition root—roughly providers, routes/workspaces, and app-level error boundaries—not a state machine for every feature. The exact target need not be reached in one rewrite.

This boundary also serves the proposed React Native Web/native direction. Moving JSX from `div` to `View` will not create portability if browser history, service workers, EventSource, terminal code, API mutations, and review state remain intertwined. The reusable asset is a platform-independent review core with explicit web/native adapters. A boundary checker can make that independence real.

### 6.2 Migrate to strict universal limits

At the original snapshot, turning on a 500-line maximum immediately would have failed much of the repository and encouraged blanket disables. The migration therefore split each oversized responsibility first, then enabled one strict Biome policy over the complete tree.

The resulting rule is simpler: existing and new files satisfy the same limits, and an oversized responsibility must be extracted rather than exempted.

Suggested starting values for evaluation—not universal truths—are:

| Target | Trial limit | Reason |
|---|---:|---|
| New production `.tsx` file | 500 nonblank, non-comment lines | Generous enough for a complex screen; below the thousand-line danger zone |
| New production `.ts` file | 700 nonblank, non-comment lines | Allows cohesive protocol/data modules while detecting accumulation |
| React component or hook function | 250 lines | Detects local god functions even when the file is split |
| Cyclomatic complexity per function | 15 | Forces review of deeply branched orchestration |
| Composition root | 300 lines after remediation | Keeps it focused on wiring |
| Test file | 1,000 lines | Tests need room, but still benefit from navigability |
| CSS file | 800 lines | Encourages feature/style ownership rather than one global sheet |

ESLint itself notes that there is no objective universal file maximum, while common recommendations are generally in the 100–500 range; it provides `max-lines`, `max-lines-per-function`, and `complexity` rules ([ESLint `max-lines`](https://eslint.org/docs/latest/rules/max-lines), [`max-lines-per-function`](https://eslint.org/docs/latest/rules/max-lines-per-function), [`complexity`](https://eslint.org/docs/latest/rules/complexity)). The correct Couchview thresholds should be calibrated by false positives and architecture evals, not treated as natural laws.

The immediate legacy policy should include at least:

- `src/client/App.tsx`: generate its normalized ceiling from the current 5,395-physical-line snapshot, target 300 normalized lines, and prohibit normalized net growth.
- `src/client/styles.css`: generate its normalized ceiling from the current 3,682-physical-line snapshot, target a feature split below 800 normalized lines per file, and prohibit normalized net growth.
- `src/client/TerminalWorkspace.tsx`: generate its normalized ceiling from the current 1,075-physical-line snapshot, target below the new-file threshold, and prohibit normalized net growth.
- Every production server file currently above its target: ceiling set to its generated normalized baseline, normalized net growth prohibited.

Freezing a hotspot does not mean minifying or deleting blank lines to buy room. The checker should count normalized nonblank/non-comment lines, and review rules should flag policy gaming. Any feature that needs new behavior in a frozen file must extract at least the touched responsibility so the file does not grow.

### 6.3 Encode dependency direction, not only size

Size is a smoke alarm, not architecture. The executable policy should also reject import edges such as:

- platform-independent core importing `react-dom`, web-only UI libraries, `window` wrappers, service-worker code, or terminal implementations;
- one feature importing another feature's internal files instead of its public entry point;
- view components importing server implementation modules;
- `App.tsx` importing feature-internal API helpers or domain mutations once public feature controllers exist;
- cycles between feature packages.

These rules are more valuable for React Native readiness than a raw line count. They preserve the option to give web and native clients different adapters around shared use cases.

### 6.4 Make policy changes harder than code changes

An agent must not be able to “fix” a failing check by raising the limit, adding an ignore pattern, or inserting an inline disable. Use one explicit waiver mechanism with fields such as:

- exact path and rule;
- reason;
- owner;
- approval reference;
- creation date;
- expiration date;
- planned removal issue.

`AGENTS.md` should say that modifying architecture policy, checker logic, CI workflow, or waivers requires explicit authorization. In GitHub, assign those files to an owner and require review. The CI check should reject undocumented inline disables and expired waivers.

### 6.5 Give the agent feedback before it stops

Use a fast check after relevant edits and a full check at turn completion:

- `PostToolUse`: when a code-editing tool changes `src/`, run a quick changed-file size and boundary report. Return precise paths, measured values, limits, and suggested next actions.
- `Stop`: run the complete architecture check. If it fails, block completion and return a concise reason so Codex continues and repairs the patch.

Current Codex hooks explicitly support running custom validation when a turn stops. A `Stop` hook can block completion; a `PostToolUse` hook can provide model-visible feedback but cannot undo an edit that already happened ([Codex hooks](https://learn.chatgpt.com/docs/hooks)). Hooks shorten the feedback loop. They are not the merge guarantee because local hooks can be untrusted, disabled, misconfigured, or bypassed.

### 6.6 Require the same check in CI

Add one stable command, for example:

```text
bun run check:architecture
```

The command should produce both human-readable failures and a machine-readable report. CI should run at least:

```text
bun run check:architecture
bun run typecheck
bun test
bun run build
```

Then protect `main`:

- require a pull request;
- require the architecture job and existing correctness jobs;
- require the branch to be current or use a merge queue;
- dismiss stale approval when the patch changes;
- require the latest push to be approved by someone other than its author where practical;
- disable administrator and automation bypass;
- prevent direct and force pushes.

If Couchview remains a solo project, the deterministic architecture job can still be mandatory. Semantic review can be performed by a fresh agent thread with a narrow architecture rubric, with the understanding that it raises confidence rather than proving correctness.

### 6.7 Add an independent architecture review

The reviewer should not receive “looks good?” as its objective. It should inspect the diff against explicit questions:

1. Which responsibilities were added, removed, or moved?
2. Does each responsibility live in its owning feature or platform adapter?
3. Did a composition root gain domain state, direct network orchestration, browser lifecycle, or substantial screen markup?
4. Did the patch reduce one metric by hiding complexity elsewhere?
5. Are new abstractions cohesive, or are they arbitrary file splitting?
6. Did any policy, waiver, checker, workflow, or generated-file exclusion change?
7. Does the web/native boundary become clearer or less clear?
8. Are behavior tests colocated with the extracted unit rather than only expanding `App.test.tsx`?

The final reviewer should be a separate run or model context when possible. External static analysis should be supplied to it rather than asking it to rediscover every violation.

## 7. What to add to `AGENTS.md`

Do not turn `AGENTS.md` into a clean-code textbook or duplicate all thresholds. Numeric rules belong in the executable policy so there is one source of truth. Add a compact section like this:

```md
## Architecture Invariants

- `src/client/App.tsx` is a composition root. It may wire providers,
  workspaces, routing, and application-wide lifecycle; feature state,
  feature mutations, network streams, and substantial rendering belong in
  their owning feature modules.
- Place each new responsibility before editing. Keep platform-independent
  review logic separate from browser and native adapters.
- All source files satisfy the Biome limits. Extract the touched responsibility
  instead of increasing a limit or adding an exclusion.
- Architecture policy, checker logic, CI enforcement, and waivers may change
  only when the user explicitly requests that policy change. Do not weaken a
  rule to make a patch pass.
- Run `bun run check:architecture` with the existing typecheck, tests, and
  build. A change is not complete while any required check fails.

## Code Review Rules

- Flag new feature workflows, direct API/EventSource orchestration, browser
  lifecycle, or substantial screen markup added to a composition root.
- Flag forbidden dependency direction, policy gaming, unapproved waivers,
  and arbitrary file splitting that preserves the original coupling.
```

This is repo-specific, actionable, and concise. It tells the agent what role `App.tsx` has, makes extraction part of the authorized scope, and points to an executable result. It does not waste context restating generic SOLID principles.

## 8. Recommended repo-local skill

A skill is appropriate for the repeatable judgment workflow, not for the hard limit itself. Name it something explicit such as `architecture-impact-review` and trigger it when a task:

- touches a listed hotspot;
- adds state, effects, mutations, or a stream to a screen/composition component;
- changes three or more production modules;
- introduces a new feature or platform adapter;
- is expected to add more than roughly 150 production lines;
- performs an architectural refactor or React Native/Web portability work.

The skill should require this sequence:

1. Read `ARCHITECTURE.md` and run the architecture report.
2. List each new responsibility and its owning module.
3. List state ownership, side effects, dependency direction, and platform-specific APIs.
4. Identify every touched hotspot and state what will be extracted or why no new responsibility enters it.
5. Plan a vertical change with behavior-preserving seams and tests.
6. Implement in small, testable steps.
7. Run focused tests after each extraction and the full required checks at the end.
8. Inspect the final diff, size deltas, import graph, new hook counts, and policy-file changes.
9. Repair violations; never edit limits or waivers unless the task explicitly authorizes policy work.
10. Report the architecture result alongside functional verification.

A suitable skill description would be:

```yaml
name: architecture-impact-review
description: >-
  Plan and verify Couchview feature or refactor work that touches an oversized
  hotspot, adds UI state/effects/mutations, crosses feature boundaries, or
  affects web/native portability. Produces a responsibility map before edits
  and runs the architecture gate before completion.
```

Do not make this skill a huge universal coding manual. Skills use prompt context when activated, and current GPT-5.6 guidance favors lean, non-duplicated instructions. Start repo-local, test its activation, and only promote it to a global personal skill if several repositories share the same measured need.

## 9. A better task contract for agentic feature work

For a nontrivial feature, use a short structured prompt rather than “implement X” or “act like a senior engineer”:

```text
Goal
Implement <observable outcome>.

Context
Relevant entry points, behavior, and constraints are <...>.

Architecture constraints
- Preserve the responsibilities and dependency direction in ARCHITECTURE.md.
- Do not bypass the Biome limits or modify policy/exclusions.
- Put platform-specific behavior behind the owning adapter.

Before editing
Produce a responsibility/change map: modules touched, state owner, side
effects, public interfaces, and tests. If the natural implementation would
grow a hotspot, include the smallest behavior-preserving extraction.

Done when
- The requested behavior and failure paths are covered.
- Typecheck, tests, build, and check:architecture pass.
- The final diff review finds no responsibility or boundary drift.
```

This prompt specifies outcome, context, constraints, and verification, matching current Codex best-practice guidance ([Codex best practices](https://learn.chatgpt.com/guides/best-practices)). It does not repeat the numeric policy or generic engineering principles.

## 10. Repository-specific evaluation plan

No change to prompts or skills should be accepted solely because it sounds wise. Build an eval that reproduces the actual failure pressure.

### 10.1 Task set

Reconstruct 15–25 tasks from parent commits in Couchview history:

- review workflow expansion;
- mobile UI behavior;
- staging helpers and bulk mutations;
- restart/PWA behavior;
- comments and approval panel;
- terminal integration;
- settings and performance caching;
- repository navigation;
- addition/deletion totals;
- at least five new portability tasks involving a shared review core and web/native adapters.

Because the original prompts are unavailable, write neutral task descriptions from user-visible behavior and tests, then start each run from the parent commit. Do not expose the gold patch.

### 10.2 Experimental conditions

Compare at least:

1. GPT-5.6 with the current repository instructions.
2. GPT-5.6 with the concise architecture section.
3. The same plus the architecture-impact skill.
4. The same plus hooks and executable feedback.
5. The full system plus an independent architecture reviewer.

Run multiple trials per task. A one-run comparison cannot measure variance.

### 10.3 Scoring

Score functional and structural dimensions separately:

| Dimension | Measurement |
|---|---|
| Functional resolution | Required unit/E2E tests and human-visible acceptance criteria |
| Regression safety | Existing typecheck, tests, and build |
| Hotspot behavior | Biome file/function limits and normalized line distribution |
| Responsibility placement | Blind rubric review against `ARCHITECTURE.md` |
| Dependency direction | Executable import-boundary report |
| Local complexity | File/function/branch metrics |
| Policy integrity | No unrequested changes to policy, checker, workflow, or waivers |
| Diff discipline | Churn, unrelated edits, and duplicated behavior |
| Portability | Platform-independent modules remain free of web/native implementation imports |
| Repair ability | Whether external feedback is fixed without weakening the check |

Track false positives and false negatives from the checker. A threshold that agents routinely game or humans routinely waive is not functioning as intended.

### 10.4 Acceptance standard

Adopt the control stack when it:

- preserves or improves functional success;
- produces zero mechanical-policy violations in the eval merge candidates;
- materially reduces hotspot growth and misplaced responsibilities;
- does not cause widespread arbitrary file splitting;
- does not materially increase incomplete task abandonment;
- repairs injected violations when the hook supplies a precise error;
- remains effective across repeated trials.

Even 100% performance on this finite eval is not a universal guarantee. It is evidence that the probabilistic layers work on representative tasks. The protected deterministic gate supplies the narrow hard guarantee.

## 11. Recommended rollout order

### Phase A: Stop further accumulation

1. Add `ARCHITECTURE.md` with current and target ownership.
2. Add an architecture policy file and a simple, deterministic checker.
3. Record current ceilings for every existing hotspot; prohibit net growth.
4. Add trial limits for new files and import boundaries.
5. Add `bun run check:architecture`.
6. Add CI and require the check on protected `main` with bypass disabled.

This phase changes no product behavior and immediately prevents further unchecked growth.

### Phase B: Improve agent behavior before the gate

1. Add the concise `AGENTS.md` architecture section.
2. Add the repo-local architecture-impact skill.
3. Add `PostToolUse` and `Stop` validation hooks.
4. Add the independent architecture-review rubric.
5. Run the historical eval and tune thresholds/skill activation.

This phase makes successful first attempts more likely and reduces repair cost.

### Phase C: Pay down the current monolith incrementally

Refactor by responsibility, not by arbitrary line ranges. A reasonable extraction order is:

1. Settings profile state and persistence queue.
2. Repository bootstrap/selection/session lifecycle.
3. Diff cache, loading, prefetch, and navigation.
4. Review comments, selection, composer, and jumps.
5. Stage/unstage/bulk/commit mutations and reconciliation.
6. Package scripts, run streams, and snapshots.
7. Search/source preview.
8. Browser history, PWA, restart, and other web adapters.
9. Screen/layout components and overlay ownership.

Each extraction should preserve behavior, move its tests with the responsibility, reduce the `App.tsx` ceiling, and leave the branch green. Avoid a single all-at-once rewrite: it would increase regression risk and make it difficult to distinguish architectural movement from behavior changes.

### Phase D: Prepare the React Native Web/native target

After the review domain and platform adapters are separated:

1. Identify the pure review state/use cases that can be shared unchanged.
2. Define narrow interfaces for navigation, storage, live events, repository access, diff rendering, and terminal capability.
3. Keep web PWA/service-worker/DOM/terminal code in web adapters.
4. Build React Native Web screens against shared use cases and platform-neutral UI primitives where that genuinely pays off.
5. Implement iOS/iPad/Android adapters separately for capabilities that are not portable.

React Native Web then becomes another presentation/platform target around a stable core, rather than a syntax conversion of the existing monolith.

## 12. Failure modes in the proposed controls

The prevention system itself needs an adversarial review.

| Failure mode | Mitigation | Residual risk |
|---|---|---|
| Agent raises a line limit | Policy files require explicit authorization and owner review | Authorized owner can still make a bad decision |
| Agent adds an ignore or inline disable | Checker rejects unregistered ignores; waiver schema with expiry | Checker may miss a novel suppression |
| Agent code-golfs to reduce lines | Count normalized lines; complexity limits; semantic review | Metrics can still be gamed |
| Agent splits code into many tiny files | Cohesion/public-API review; dependency/cycle checks | Cohesion remains partly subjective |
| Agent moves web dependencies into shared core | Forbidden import edges in CI | Runtime/dynamic imports may need extra analysis |
| Hook does not run | Required CI executes independently | Local feedback is lost, but merge gate remains |
| Same agent approves its own architecture | Fresh review context; human review for high-risk changes | Review remains probabilistic |
| CI workflow is weakened in the patch | Workflow/checker/policy ownership and required review | Repository administrators retain ultimate authority |
| Existing giant file blocks all work | Extract cohesive responsibilities before enabling the strict maximum | Migration work must land before enforcement |
| Splitting preserves the original coupling | Review rule and architecture map | Cohesion is not mechanically decidable in full |
| Threshold causes false positives | Representative evals and explicit expiring waivers | Calibration requires maintenance |
| Instructions bloat the context | Keep numbers in policy, workflow in skill, invariants in `AGENTS.md` | Skill can still grow stale |

## 13. Final verdict

### Why this happened

The best-supported explanation is a reinforcing interaction between an already-monolithic starting point, feature-by-feature local optimization, regression-averse scope control, behavior-only completion signals, missing architecture ownership, and no external detector. The model knew enough to extract leaf components, but the system never made central responsibility growth fail.

### What not to do

- Do not rely on “be a senior engineer.”
- Do not put a generic ban on 6,000-line files in a long `AGENTS.md` and call the issue solved.
- Do not assume GPT-5.6, maximum reasoning, planning mode, or self-review creates certainty.
- Do not use passing tests as a proxy for maintainability.
- Do not raise a universal limit merely to accommodate legacy coupling; extract the responsibilities first.
- Do not let the same patch silently alter the rule that judges it.

### What to do

Use GPT-5.6 as a capable implementer inside an engineered feedback system:

1. Specify Couchview's responsibility and platform boundaries.
2. Make extraction part of the authorized feature scope when a hotspot is touched.
3. Encode measurable limits and dependency direction.
4. Feed violations back to the agent immediately.
5. Require the check in CI on protected `main` with no bypass.
6. Review semantic architecture independently.
7. Evaluate the complete workflow across repeated historical tasks.
8. Keep all current and future files within the strict Biome limits.

That is how to obtain behavior resembling a responsible mid-level engineer consistently: not by assuming the model will remember every principle, but by giving it an explicit architecture, the authority to preserve it, external feedback when it drifts, and a merge process that cannot accept known violations.

## Appendix A: Evidence-strength ledger

| Claim | Evidence type | Strength | Limitation |
|---|---|---|---|
| Couchview normalized `App.tsx` as the feature hub | Direct history and source | High | Does not reveal hidden reasoning |
| Tests/build did not constrain architecture | Direct scripts/config inspection | High | A human may have applied undocumented judgment |
| No remote hard gate existed | GitHub API snapshot | High | State can change after 2026-08-01 |
| Planning helps repository-wide coordination | CodePlan controlled comparison | Moderate | Older models and narrow migration/edit tasks |
| External diagnostics help models repair flaws | Static-analysis feedback study | Moderate | C code and open-source models, not GPT-5.6 repo work |
| Intrinsic self-review is insufficient | ICLR/ACL reasoning studies plus OpenAI audit process | Moderate | Reasoning/eval auditing is not identical to architecture review |
| Long context creates retrieval risk | TACL study | Moderate | Older models and non-coding tasks |
| Prompt-only non-functional quality is unstable | 2026 JSS multi-method study | Moderate to high | Its exact models/tasks differ from Couchview |
| GPT-5.6 benefits from modularity/structure/planning instructions | Current official OpenAI guidance | High for recommended use | Product guidance is not an architectural guarantee |
| Concise repository review rules improve detection | OpenAI internal eval report | Moderate to high | Review suite, not generation; 98% is not 100% |
| Training data caused this exact file | No accessible evidence | Unknown | Proprietary data and no causal trace |
| CI can block encoded violations | Deterministic system design plus GitHub controls | High under explicit assumptions | Only covers encoded predicates and non-bypassed paths |

## Appendix B: Source notes

- [OpenAI GPT-5.6 prompting best practices](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices): current model-specific advice; supports lean prompts, explicit boundaries, and eval-driven tuning.
- [OpenAI prompt engineering—coding](https://developers.openai.com/api/docs/guides/prompt-engineering#coding): current guidance on testing, modular components, structure, backend separation, and planning.
- [Codex best practices](https://learn.chatgpt.com/guides/best-practices): official task-contract, planning, verification, and `AGENTS.md` guidance.
- [Codex `AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md): official persistent-instruction discovery and scoping.
- [Codex skills](https://learn.chatgpt.com/docs/build-skills): official reusable-workflow packaging and progressive disclosure.
- [Codex hooks](https://learn.chatgpt.com/docs/hooks): official lifecycle validation and stop-blocking mechanisms.
- [Custom code review rules for Codex](https://developers.openai.com/blog/custom-code-review-rules-for-codex): official evidence for concise, scoped semantic review rules and the role of CI.
- [SWE-bench evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/) and [paper](https://arxiv.org/abs/2310.06770): primary description of patch-and-test repository evaluation.
- [OpenAI coding-evaluation audit](https://openai.com/index/separating-signal-from-noise-coding-evaluations/): current evidence that prompts and tests can mismeasure real capability and benefit from experienced independent review.
- [SWE-agent](https://arxiv.org/abs/2405.15793): primary evidence that the agent-computer interface materially affects software-agent performance.
- [CodePlan](https://arxiv.org/abs/2309.12499): primary evidence for repository-aware planning and change-impact analysis.
- [Quality Assurance of LLM-generated Code](https://arxiv.org/abs/2511.10271): 2026 multi-method evidence on non-functional quality and prompt instability.
- [CodeSmellEval](https://arxiv.org/abs/2412.18989) and [Investigating the Smells of LLM Generated Code](https://arxiv.org/abs/2510.03029): code-quality evidence with important model/task caveats.
- [Testing and static-analysis feedback](https://arxiv.org/abs/2412.14841): primary evidence for external detection followed by model repair.
- [Lost in the Middle](https://arxiv.org/abs/2307.03172): primary long-context evidence, used only as supporting mechanism evidence.
- [Large Language Models Cannot Self-Correct Reasoning Yet](https://proceedings.iclr.cc/paper_files/paper/2024/hash/8b4add8b0aa8749d80a34ca5d941c355-Abstract-Conference.html) and [LLMs cannot find reasoning errors, but can correct them given the error location](https://aclanthology.org/2024.findings-acl.826/): primary evidence distinguishing intrinsic review from externally located errors.
- [METR long-task paper](https://arxiv.org/abs/2503.14499) and [2026 scaffold comparison](https://metr.org/notes/2026-02-13-measuring-time-horizon-using-claude-code-and-codex/): current probabilistic framing and a caution against assuming elaborate scaffolds guarantee long-horizon reliability.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches): official enforcement options and bypass caveats.
- [ESLint `max-lines`](https://eslint.org/docs/latest/rules/max-lines), [`max-lines-per-function`](https://eslint.org/docs/latest/rules/max-lines-per-function), and [`complexity`](https://eslint.org/docs/latest/rules/complexity): current deterministic guardrail options; thresholds still require local calibration.

## Appendix C: Implemented policy shape

`biome.jsonc` is the only source of file and function line limits. Production
TypeScript uses a 700-line file and 300-line function ceiling, production TSX
uses a 700-line file and 250-line function ceiling, CSS uses an 800-line file
ceiling, and tests use a 1,000-line file ceiling. `App.tsx` remains under its
more focused 300-line file and 250-line function limits.

The architecture checker deliberately does not count lines. Its fixture tests
cover import direction, composition-root imports, and attempts to hide blanket
suppressions. Biome's own diagnostics and tests cover the generic size and
complexity rules.

## Appendix D: Minimum assurance checklist

Before claiming that recurrence is mechanically prevented, verify all of the following:

- [x] `ARCHITECTURE.md` defines the composition root, feature ownership, and web/native boundary.
- [x] Biome fails files and functions above the configured limits; the architecture checker fails forbidden imports and suppressions.
- [x] Every source file satisfies the applicable strict limit without a legacy exception.
- [x] Source limits and import boundaries are enforced in CI; Biome supplies the file, function, and complexity rules.
- [x] No separate line-count policy or waiver mechanism exists.
- [x] `AGENTS.md` references the architecture command and forbids unrequested policy weakening.
- [ ] The architecture-impact skill activates on hotspot and cross-feature tasks in a clean session.
- [x] Project-local `PostToolUse` and `Stop` hooks are configured to return the checker diagnostic to Codex; trust and live failure-path evaluation remain operator steps.
- [x] CI is configured to run architecture, formatting, lint, type, unit, and build checks on pull-request merge candidates.
- [ ] `main` requires that CI status, pull requests, and review of policy/checker/workflow changes.
- [ ] Direct push, force push, administrator bypass, and automation bypass are disabled or separately audited.
- [ ] A fresh reviewer checks semantic cohesion and policy gaming.
- [ ] Reconstructed historical tasks pass the functional and structural eval in repeated runs.
- [ ] A scheduled audit checks for stale instructions, thresholds, waivers, and architecture boundaries.

Until the CI and branch-protection items are true, the system can improve behavior but cannot honestly claim the narrow hard guarantee described in Section 4.
