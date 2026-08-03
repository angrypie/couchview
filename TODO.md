# To-do

This file is the project's lightweight task board.

When adding a task:

- Add it to **Backlog** unless a different section is requested.
- Use `- [ ] Task description` for open tasks.
- Keep tasks short, specific, and actionable.
- Move active tasks to **Sprint**.
- Move completed tasks to **Done** and change them to `- [x]`.

## Backlog

<!-- New tasks are added here by default. -->

- [ ] Implement offline diff viewing for explicitly downloaded repository snapshots.
      Persist the app shell, file list, existing review state, and every diff preview in bounded,
      revision-keyed browser storage; support navigation after disconnect or reload, stale-cache
      invalidation, cache removal, download progress, and offline regression coverage.
- [ ] Add Speech to Text functionality by streaming from server.
- [ ] Evaluate Tailwind and other suitable styling libraries, then plan an eventual migration.
- [ ] Simplify sending code and file context to the AI agent helper.
      Keep common code-explanation and file-understanding workflows inside Couchview instead of
      forcing users to switch back to ChatGPT for every question.
- [ ] Evaluate whether the new custom import-direction check is needed and decide whether to keep,
      revise, or remove it.

## Sprint

<!-- Tasks currently being worked on. -->

## Done

<!-- Completed tasks. -->

- [x] Split oversized legacy files and enforce strict line limits through Biome without
      exclusions.
