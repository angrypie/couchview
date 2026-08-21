# Unified diff viewer design

- **Status:** Current
- **Owner:** Couchview maintainers
- **Last verified:** 2026-08-22
- **Superseded by:** —

## Goal

Couchview renders one semantic unified-diff surface on React Native and web.
The same scene, token stream, row contract, Legend List implementation,
navigation queries, and interaction contract run on web and iOS. The row host
is specialized at the platform file boundary: direct DOM on web and React
Native `View`/`Text`/SVG on native. There is no WebView, browser canvas
renderer, iOS image renderer, or runtime renderer-selection layer.

The surface must preserve:

- exact line and wrapped-row geometry;
- hunk and source-line navigation;
- progressive syntax highlighting without replacing the list;
- identifier actions, selectable text, and accessible controls;
- settled visible-line reporting; and
- bounded mounted work from ordinary diffs through the server's large-diff
  limit.

## Responsibility map

`src/client/components/diff/` is one deep module with these internal owners:

```text
DiffViewer / DiffView
  public commands, parsing, geometry, scene identity, token lifecycle
        |
        v
DiffRenderSession
  immutable scene snapshot + incremental token revisions
        |
        v
LegendDiffSurface
  vertical virtualization, horizontal viewport, readiness, scroll events
        |
        v
DiffRowView(.web)
  platform row host, selection, token styles, identifier accessibility
```

- `DiffView.tsx` translates the public `DiffViewerHandle` into generation-
  scoped scene commands. It owns no platform renderer branch.
- `scene/` resolves every visual role, exact row size and offset, content size,
  line/hunk target, visible-line query, and identifier coordinate.
- `paint/DiffTokenLayer.ts` publishes stable row-token references and a bounded
  revision history.
- `surface/DiffRenderSession.ts` is the only handoff between orchestration and
  the viewport.
- `surface/LegendDiffSurface.tsx` is the only production surface. It imports
  `LegendList` from `@legendapp/list/react-native`, which is the package entry
  used by both native and React Native Web. Its extensionless row import is the
  only platform-selection seam inside the surface.
- `DiffRowView.tsx` renders the native row host and owns the shared prop
  contract. `DiffRowView.web.tsx` renders the equivalent browser DOM host.
  Neither file owns list, parsing, tokenization, or navigation behavior.
- `engine/` remains platform-independent and imports no React, React Native,
  DOM, feature, or server code.

## One Legend List surface

The vertical viewport is `LegendList<DiffSceneRow>` with the following
invariants:

- `keyExtractor` returns the scene row's stable `id`.
- `getFixedItemSize` returns the row's authoritative `height`. On web, the
  pinned Legend patch feeds that known size through the normal measurement
  bookkeeping without a recycled-row DOM rectangle read; intrinsic cross-axis
  sizing still falls back to real measurement.
- `getItemType` uses the row kind so recycling stays within compatible row
  shapes.
- `dataKey` contains repository, file, content, and layout revisions. A new
  authoritative document or width-dependent layout replaces list state; a
  height-only viewport change does not.
- `maintainVisibleContentPosition` is disabled because scene offsets and public
  navigation own the anchor.
- recycling is enabled and draw distance is bounded. Logical row count may be
  thousands while only the viewport and overscan remain mounted.

An outer React Native `ScrollView` owns horizontal movement. The Legend list
owns vertical movement inside an exact-width content view. This keeps long-line
panning independent of vertical recycling, while wrap mode constrains content
to the measured viewport.

`LegendList.onLoad` marks a scene generation ready. Imperative navigation uses
the list's asynchronous `scrollToOffset` and preserves the current horizontal
offset unless `scrollToTop` explicitly supplies zero. Raw scroll offsets and
Legend's first-visible-item signal feed one 120 ms settle debounce; native drag
and momentum endpoints report immediately. The shared scene then converts the
settled y coordinate into the topmost source line.

## Exact geometry

The viewer never measures text. Geometry is derived once from the bundled
monospace font and display preferences:

- character stride is the Iosevka advance plus configured letter spacing;
- tabs expand to the next two-column stop;
- line height is `fontSize * 1.55 + lineHeightAdjustment`;
- metadata separators use their fixed scene height;
- wrap height is `ceil(visualColumns / availableColumns) * lineHeight`;
- prefix offsets make row and target queries logarithmic; and
- content width is the gutter plus the larger of the viewport or longest
  expanded line.

The exact same `row.height` drives the scene, Legend's fixed-size callback, and
the rendered platform row. Stable keys and exact sizes are correctness
requirements, not tuning hints.

## Progressive tokens without list-wide renders

Rows appear immediately as selectable plain text. The checkpointed tokenizer
publishes batches to `DiffTokenLayer`; it does not replace the scene or list
data. The surface snapshot intentionally ignores token revision changes, while
each mounted `LegendDiffRow` subscribes to the token reference for only its row.
When a batch lands, changed visible rows render and unaffected rows retain their
element and token identities. Web token spans use stable positions so recycled
rows update existing DOM nodes instead of replacing the colored subtree.

The web-only hidden status node exposes logical row count, token completion,
and revision to integration and benchmark harnesses. It is observational and
does not participate in layout or drive list updates.

## Engine ownership

The owned engine replaces the former Pierre pipeline:

- `adapt.ts` consumes the structured `FileDiff` contract. Only the server's
  full-context patch crosses the unified-patch parser.
- `rows.ts`, `metrics.ts`, and `palette.ts` own row semantics, decorations,
  geometry, and colors.
- grammar modules load on demand; unknown languages remain plain text.
- `LineTokenizer` processes 64-line chunks and stores grammar-state
  checkpoints, so an interrupted file resumes from the nearest valid state.
- the bounded token cache includes authoritative content/theme identity and
  counts text plus checkpoint memory.
- context token objects degrade above the configured threshold while changed
  lines retain detailed runs; the grammar walk still preserves state.
- web uses Oniguruma WASM. Native uses the Nitro Oniguruma bridge and falls
  back to Shiki's JavaScript engine when a development build lacks the native
  module.

The web and native engines use the same vendored themes and grammar modules.
The Nitro bridge is byte-parity tested against the WASM engine.

## Selection, identifiers, and accessibility

Every line, separator, and no-newline marker remains selectable semantic text:
React Native `Text` on native and DOM text/span elements on web. Token runs stay
nested text rather than painted pixels. Interactive identifier runs have a
button role and an explicit `Find “name” in project` label. Presses send the
shared row index and column; scene geometry converts that position to document
coordinates, and the shared token query resolves the identifier before opening
project search.

On web, the list exposes a `code` landmark and row metadata used by browser
tests. The direct DOM row host preserves whitespace, selection, token colors,
identifier focus/keyboard activation, line-number geometry, and addition or
deletion indicators without routing row updates through React Native Web's
host-prop and style conversion.

## Failure and fallback behavior

Patch adaptation failures render the existing plain-text fallback. A
non-recoverable surface failure does the same. There is no second production
renderer to select or keep synchronized. Tokenization failure leaves useful
plain semantic rows mounted, and recoverable navigation failures are reported
through the private surface event sink.

## Verification contract

- Unit tests cover parsing, scene geometry and queries, token checkpoints and
  cache behavior, session revision semantics, row-scoped token updates, stable
  surface identity, and distant navigation.
- Browser integration covers exact fixed geometry, bounded mounting, text
  selection, identifier accessibility and syntax colors during an active touch
  gesture, zero recycled-row rectangle reads, hunk navigation, settled
  visible-line reporting, and deep/end jumps at 250 through 5,000 source lines.
- The mobile Playwright suite covers typography, wrapping, display controls,
  and the absence of canvas rendering in the production web build.
- iOS verification uses a fresh native build and public accessibility/device
  performance surfaces for scrolling, selection/identifier behavior, wrapping,
  line numbers, navigation, and bounded large-file behavior.
- `bun run benchmark:diff-scroll:verify` measures the real production web
  surface at 250 and 5,000 source lines. See [benchmarks.md](benchmarks.md) for methodology and
  recorded evidence.
- Completion requires `bun run check:quality` and the architecture gate. The
  row host is the sole deliberate platform file split; there is no renderer
  waiver or runtime renderer selector.
