# Git workspace module

The Git workspace is an internal module split across matching project layers:

- `src/shared/git/index.ts` is the public HTTP contract and route surface.
- `src/client/features/git/index.ts` owns client state and the transport adapter.
- `src/client/components/git/index.ts` owns the responsive Git presentation.
- `src/server/git/index.ts` is the server entry point for Git commands, history, actions,
  mutation serialization, and HTTP route handling.

Code outside those module directories must import their `index.ts` entry points rather than an
implementation file. The architecture checker enforces that rule.

The client presentation is a full workspace page at `/history`, not a modal.
The shell owns its URL transitions; the Git feature keeps loaded history and
bounded preview caches alive across page navigation.

## Replacement seams

`RepositoryGitModule` is the repository-facing capability. A different history/action engine can
replace `createRepositoryGitModule` while keeping the repository and HTTP contracts stable.

`GitExecutionPort` is the lower-level command seam used by the current implementation. The default
adapter executes the local Git CLI; tests or another compatible backend can inject a different
executor. Staging, committing, and Git workspace actions share the module-owned mutation
coordinator so index-changing operations remain serialized.

Keep portable request/response types in the shared entry point, browser state in the feature entry
point, DOM presentation in the component entry point, and Git/process behavior in the server entry
point.
