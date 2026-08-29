# Command Palette and Quick Picker

**Audience:** People navigating Couchview by keyboard and contributors extending command or
selection workflows.

## Two keyboard surfaces

Couchview has two related but separate keyboard surfaces:

| Surface | Default shortcut | Purpose |
| --- | --- | --- |
| **Command Palette** | `Cmd+K` on Apple platforms; `Ctrl+K` on Windows and Linux | Find and run application commands, navigation, and actions. |
| **Projects Quick Picker** | `G P` | Fuzzily find and switch to an available registered Repository. |
| **Files Quick Picker** | `Ctrl+P` on every platform | Fuzzily find a file in the current Repository. |

The Command Palette default uses Couchview's portable `Mod` modifier, while the Files shortcut uses
explicit `Ctrl` on every platform. Keyboard shortcuts can be changed in **Settings → Keyboard
shortcuts**. The Command Palette shortcut must keep a modifier so ordinary typing cannot open it
accidentally.

The Command Palette and Quick Picker are implemented by Couchview; the project does not depend on
the external `cmdk` package. They share the command registry, shortcut engine, and design-system
dialog, input, and list primitives. The Command Palette remains optimized for a small catalogue of
application commands, while Quick Picker owns high-volume Repository and file selection.

## Quick Picker controls

Quick Picker opens without an animation and focuses its search input immediately. Its results area
has a stable height, so filtering does not move the surrounding dialog.

- Type one or more fuzzy terms in any order. File results favor contiguous filename matches, path
  boundaries, and short gaps, similar to `fzf` path search.
- Press `Arrow Up` or `Arrow Down` to move through results.
- Press `Enter` to open the active result. The first result is active by default.
- Press `Ctrl+C` on any platform or `Escape` to close the picker.
- Mouse and touch selection use the same result actions as the keyboard.

Arrow and Enter handling is scoped to the search input. It does not intercept controls elsewhere in
the dialog. Pressing `Ctrl+P` again while Files is open is consumed, including key repeats, so the
browser does not handle it.

### Switching Repositories

Press `G`, then `P` to open **Projects**. The current Repository is first when it is available.
Continue holding `G` and press `P` repeatedly to cycle through the results; release `G` to end the
cycle. Selecting a result updates the Repository-backed URL and preserves normal browser history.

Unavailable Repository entries are excluded from Quick Picker. Use **Manage projects…** in its
footer to open the full Repository-management surface for adding, rebuilding, or forgetting
entries.

### Opening files

Press `Ctrl+P` on any platform to open **Files** for the current Repository. Search covers tracked
files and non-ignored untracked files that still exist in the working tree. Ignored and deleted
paths are excluded.

Selecting any result closes Quick Picker and opens the file in Couchview's normal, full-size main
diff viewer. A current File Change opens as its review diff, with the usual review and staging
actions. A file without a File Change opens as read-only source in the same viewer; review and
staging actions remain unavailable because there is no change to apply them to.

### Opening text-search matches

**Find in project** uses the same main-view navigation. Selecting a text-search result closes the
search sheet, opens the selected file in the full-size main diff viewer, and focuses the matching
line. Changed files retain their normal review diff and review or staging actions. Unchanged source
files remain read-only. If a very large changed-file diff does not contain the matching line,
Couchview loads a bounded source section around it in the same viewer while keeping that file's
review and staging actions available.

## Performance and consistency

Quick Picker builds a reusable normalized index and returns at most 200 visible matches. It uses
uFuzzy to narrow Unicode-aware candidates, then ranks every candidate with an `fzf`-style
best-alignment score. The file-search scheme rewards consecutive characters, filename and path
boundaries, camel-case or number transitions, and basename matches while penalizing gaps. It does
not stop ranking when a query has many matches. File catalogues load only when Files is opened and
are bounded to 50,000 paths. The client caches a bounded number of catalogues by exact Repository
identity and operation revision. A Repository or revision change aborts in-flight catalogue and
file-open requests, ignores stale responses, and prevents content from one revision appearing under
another.

The server obtains the catalogue from Git with `git ls-files`, including tracked and non-ignored
untracked paths, then removes deleted paths. It brackets the read with authoritative Repository
snapshots and retries once if the operation revision changes during the catalogue request.

## Implementation ownership

- `src/client/CommandPalette.tsx` renders the custom Command Palette.
- `src/client/features/commands/` owns command availability, execution, and palette state.
- `src/client/features/quickPick/` owns Quick Picker modes, fuzzy indexes, keyboard behavior,
  revision-safe file catalogues, and selection.
- `src/client/features/search/` owns text-search queries and results.
- `src/client/features/review/` owns the selected main-view file, read-only source loading, and
  focused-line navigation.
- `src/client/components/quickPick/` renders the fixed, virtualized Quick Picker dialog.
- `src/client/lib/fuzzyQuickPick.ts` owns feature-neutral fuzzy candidate filtering and fzf-style
  ranking, including the path-specific scoring scheme.
- `src/shared/settings.ts` owns portable shortcut defaults and profile persistence.
- `src/server/repositoryContent.ts` and the Repository routes own the Git-backed file catalogue.

Add new selection modes or result actions through the Quick Picker feature controller and keep
their presentation in the Quick Picker component folder. Application commands remain in the shared
command registry and Command Palette instead of being duplicated as picker-only actions.
