import { type CodeViewOptions, DEFAULT_THEMES } from "@pierre/diffs";
import {
	CodeView,
	type CodeViewHandle,
	type CodeViewItem,
	type CodeViewScrollTarget,
} from "@pierre/diffs/react";
import {
	type CSSProperties,
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
} from "react";
import type { FileDiff } from "../shared/contracts.ts";
import type { ResolvedTheme } from "../shared/theme.ts";
import {
	adaptFileDiff,
	fromPierreSide,
	reconstructUnifiedPatch,
	toPierreSide,
} from "./diffAdapter.ts";
import type { DiffViewerHandle, ViewerLineTarget } from "./features/review/types.ts";
import { DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER } from "./typographyPreferences.ts";

export type { DiffViewerHandle, ViewerLineTarget };

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$-]*$/;

const PIERRE_UNSAFE_CSS = `
:host {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  --diffs-bg: var(--viewer-bg, #0d1014);
  --diffs-dark-bg: var(--viewer-bg, #0d1014);
  --diffs-dark: var(--viewer-text, #e7edf5);
  --diffs-font-family: var(--code-font-family, "Iosevka", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace);
  --diffs-letter-spacing: 0px;
  --diffs-min-number-column-width: 1ch;
  --diffs-bg-context-override: var(--viewer-context, #131820);
  --diffs-bg-separator-override: var(--viewer-separator, #17243a);
  --diffs-bg-addition-override: var(--viewer-addition, #112b22);
  --diffs-bg-deletion-override: var(--viewer-deletion, #321a1e);
  --diffs-fg-number-override: var(--viewer-number, #718096);
  --diffs-addition-color-override: var(--viewer-green, #52d091);
  --diffs-deletion-color-override: var(--viewer-red, #ff7f85);
  --diffs-modified-color-override: var(--viewer-accent, #7da6ff);
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0, "calt" 0;
  letter-spacing: var(--diffs-letter-spacing);
}
[data-diff]:not([data-disable-line-numbers]) [data-column-number] {
  padding-inline: .45ch !important;
}
[data-line-number-content] {
  min-width: 1ch !important;
}
[data-char][role="button"] {
  cursor: pointer;
}
[data-char][role="button"]:focus-visible {
  z-index: 5;
  border-radius: 2px;
  outline: 2px solid var(--viewer-accent, #7da6ff);
  outline-offset: -1px;
}
[data-char][role="button"]:hover {
  border-radius: 2px;
  background: color-mix(in srgb, var(--viewer-accent, #7da6ff) 25%, transparent);
}
`;

interface DiffViewerProps {
	diff: FileDiff;
	fontFamily: string;
	fontSize: number;
	lineHeightAdjustment: number;
	widthAdjustment: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	interactive?: boolean;
	themeType?: ResolvedTheme;
	onIdentifierClick(identifier: string): void;
	onVisibleLineChange(lineNumber: number, side: "old" | "new"): void;
}

function hunkTarget(diff: FileDiff, hunkIndex: number): ViewerLineTarget | null {
	const hunk = diff.hunks[hunkIndex];
	if (!hunk) return null;
	const firstLine = hunk.lines.find(
		(line) => line.kind !== "metadata" && (line.newLine !== null || line.oldLine !== null),
	);
	if (firstLine?.newLine !== null && firstLine?.newLine !== undefined) {
		return { lineNumber: firstLine.newLine, side: "new", align: "start" };
	}
	if (firstLine?.oldLine !== null && firstLine?.oldLine !== undefined) {
		return { lineNumber: firstLine.oldLine, side: "old", align: "start" };
	}
	if (hunk.newLines > 0) {
		return { lineNumber: hunk.newStart, side: "new", align: "start" };
	}
	if (hunk.oldLines > 0) {
		return { lineNumber: hunk.oldStart, side: "old", align: "start" };
	}
	return null;
}

function keyActivates(event: KeyboardEvent): boolean {
	return event.key === "Enter" || event.key === " ";
}

function enhanceRenderedDiff(
	host: HTMLElement,
	phase: "mount" | "update" | "unmount",
	fontFamily: string,
	fontSize: number,
	lineHeight: number,
	letterSpacing: number,
	interactive: boolean,
): void {
	const root = host.shadowRoot;
	if (!root) return;

	const interactiveElements = root.querySelectorAll<HTMLElement>(
		"[data-column-number], [data-char]",
	);
	for (const element of interactiveElements) {
		element.onkeydown = null;
		element.removeAttribute("role");
		element.removeAttribute("tabindex");
		element.removeAttribute("aria-label");
		element.removeAttribute("title");
	}
	if (phase === "unmount") return;

	// Mobile Safari can independently inflate wide code blocks, which makes an
	// 11px preference render closer to 16px for some files. Keep the sizing on
	// Pierre's actual shadow host (not only its React wrapper), and pin its row
	// metric to the same value whenever a virtualized item is mounted or reused.
	host.style.setProperty("-webkit-text-size-adjust", "100%");
	host.style.setProperty("text-size-adjust", "100%");
	host.style.setProperty("--diffs-font-family", fontFamily);
	host.style.setProperty("--diffs-font-size", `${fontSize}px`);
	host.style.setProperty("--diffs-line-height", `${lineHeight}px`);
	host.style.setProperty("--diffs-letter-spacing", `${letterSpacing}px`);
	if (!interactive) return;

	for (const token of root.querySelectorAll<HTMLElement>("[data-char]")) {
		if (token.querySelector("[data-char]")) continue;
		const identifier = token.textContent ?? "";
		if (!IDENTIFIER_PATTERN.test(identifier)) continue;
		const label = `Find “${identifier}” in project`;
		token.setAttribute("role", "button");
		token.tabIndex = 0;
		token.setAttribute("aria-label", label);
		token.title = label;
		token.onkeydown = (event) => {
			if (!keyActivates(event)) return;
			event.preventDefault();
			token.click();
		};
	}
}

function toScrollTarget(diffId: string, target: ViewerLineTarget): CodeViewScrollTarget {
	return {
		type: "line",
		id: diffId,
		lineNumber: target.lineNumber,
		side: toPierreSide(target.side),
		align: target.align ?? "nearest",
		behavior: target.behavior ?? "smooth",
	};
}

export const DiffViewer = forwardRef<DiffViewerHandle, DiffViewerProps>(function DiffViewer(
	{
		diff,
		fontFamily,
		fontSize,
		interactive = true,
		lineHeightAdjustment,
		widthAdjustment,
		lineNumbersVisible,
		lineWrapEnabled,
		onIdentifierClick,
		onVisibleLineChange,
		themeType = "dark",
	},
	ref,
) {
	const codeViewRef = useRef<CodeViewHandle<never>>(null);
	const scrollFrameRef = useRef<number | null>(null);
	const pendingAnchorRef = useRef<{
		lineNumber: number;
		side: "old" | "new";
	} | null>(null);

	const adapted = useMemo(() => {
		try {
			return { value: adaptFileDiff(diff), error: null };
		} catch (error) {
			return {
				value: null,
				error: error instanceof Error ? error : new Error("The patch could not be parsed."),
			};
		}
	}, [diff]);

	const lineHeight = Math.max(
		4,
		fontSize * DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER + lineHeightAdjustment,
	);

	const items = useMemo<CodeViewItem<never>[]>(() => {
		if (!adapted.value) return [];
		return [
			{
				id: diff.fileId,
				type: "diff",
				fileDiff: adapted.value.fileDiff,
			},
		];
	}, [adapted.value, diff.fileId]);

	const handleScroll = useCallback(
		(scrollTop: number, viewer: NonNullable<ReturnType<CodeViewHandle<never>["getInstance"]>>) => {
			const rendered = viewer
				.getRenderedItems()
				.find((item) => item.type === "diff" && item.id === diff.fileId);
			if (!rendered || rendered.type !== "diff") return;
			const localTop = Math.max(0, scrollTop - viewer.getLocalTopForInstance(rendered.instance));
			const anchor = rendered.instance.getNumericScrollAnchor(localTop);
			if (!anchor) return;
			pendingAnchorRef.current = {
				lineNumber: anchor.lineNumber,
				side: fromPierreSide(anchor.side ?? "additions"),
			};
			if (scrollFrameRef.current !== null) return;
			scrollFrameRef.current = window.requestAnimationFrame(() => {
				scrollFrameRef.current = null;
				const pending = pendingAnchorRef.current;
				if (pending) onVisibleLineChange(pending.lineNumber, pending.side);
			});
		},
		[diff.fileId, onVisibleLineChange],
	);

	useEffect(
		() => () => {
			if (scrollFrameRef.current !== null) {
				window.cancelAnimationFrame(scrollFrameRef.current);
			}
		},
		[],
	);

	const scrollToLine = useCallback(
		(target: ViewerLineTarget) => {
			codeViewRef.current?.scrollTo(toScrollTarget(diff.fileId, target));
		},
		[diff.fileId],
	);

	useImperativeHandle(
		ref,
		() => ({
			scrollToLine,
			scrollToHunk(hunkIndex) {
				const target = hunkTarget(diff, hunkIndex);
				if (target) scrollToLine({ ...target, behavior: "instant" });
			},
			scrollToTop() {
				codeViewRef.current?.scrollTo({ type: "position", position: 0 });
			},
		}),
		[diff, scrollToLine],
	);

	const options = useMemo<CodeViewOptions<never>>(
		() => ({
			theme: DEFAULT_THEMES,
			themeType,
			diffStyle: "unified",
			diffIndicators: "bars",
			hunkSeparators: "metadata",
			expandUnchanged: true,
			lineDiffType: "word-alt",
			overflow: lineWrapEnabled ? "wrap" : "scroll",
			disableFileHeader: true,
			disableLineNumbers: !lineNumbersVisible,
			enableLineSelection: false,
			lineHoverHighlight: "line",
			useTokenTransformer: true,
			tokenizeMaxLineLength: 2_000,
			tokenizeMaxLength: 100_000,
			itemMetrics: {
				lineHeight,
				paddingTop: 0,
				paddingBottom: 0,
			},
			layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
			unsafeCSS: PIERRE_UNSAFE_CSS,
			onTokenClick(props) {
				if (!interactive || props.type !== "token" || !IDENTIFIER_PATTERN.test(props.tokenText))
					return;
				onIdentifierClick(props.tokenText);
			},
			onPostRender(node, _instance, phase) {
				enhanceRenderedDiff(
					node,
					phase,
					fontFamily,
					fontSize,
					lineHeight,
					widthAdjustment,
					interactive,
				);
			},
		}),
		[
			fontFamily,
			fontSize,
			interactive,
			lineHeight,
			lineHeightAdjustment,
			lineNumbersVisible,
			lineWrapEnabled,
			onIdentifierClick,
			themeType,
			widthAdjustment,
		],
	);

	if (!adapted.value) {
		let patch = "";
		try {
			patch = reconstructUnifiedPatch(diff);
		} catch {
			patch = diff.header.join("\n");
		}
		return (
			<div className={`patch-fallback ${lineWrapEnabled ? "wrap-lines" : ""}`} role="alert">
				<div className="patch-fallback-message">
					Syntax rendering failed: {adapted.error?.message ?? "invalid patch"}. Showing plain text.
				</div>
				<pre>{patch}</pre>
			</div>
		);
	}

	return (
		<div className="diff-viewer-shell">
			{diff.tooLarge && (
				<div className="truncated-banner" role="status">
					Showing the first 2 MiB or 20,000 rows.
				</div>
			)}
			{diff.fullFilePatch === null && !diff.tooLarge && (
				<div className="truncated-banner" role="status">
					Complete file exceeds 2 MiB or 20,000 rows. Showing diff hunks instead.
				</div>
			)}
			<CodeView<never>
				className="pierre-code-view"
				items={items}
				onScroll={handleScroll}
				options={options}
				ref={codeViewRef}
				style={
					{
						"--diffs-font-family": fontFamily,
						"--diffs-font-size": `${fontSize}px`,
						"--diffs-line-height": `${lineHeight}px`,
						"--diffs-letter-spacing": `${widthAdjustment}px`,
						WebkitTextSizeAdjust: "100%",
						textSizeAdjust: "100%",
					} as CSSProperties
				}
			/>
		</div>
	);
});
