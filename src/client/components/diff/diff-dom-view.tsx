"use dom";

import { type CodeViewOptions, DEFAULT_THEMES } from "@pierre/diffs";
import {
	CodeView,
	type CodeViewHandle,
	type CodeViewItem,
	type CodeViewScrollTarget,
} from "@pierre/diffs/react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef } from "react";

import {
	adaptFileDiff,
	fromPierreSide,
	reconstructUnifiedPatch,
	toPierreSide,
} from "../../diffAdapter.ts";
import type { ViewerLineTarget } from "../../features/review/types.ts";
import { DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER } from "../../typographyPreferences.ts";
import type { DiffDomProps } from "./diff-dom-contract.ts";

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$-]*$/;

const PIERRE_UNSAFE_CSS = `
:host {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  --diffs-bg: var(--viewer-bg, #0d1014);
  --diffs-dark-bg: var(--viewer-bg, #0d1014);
  --diffs-dark: var(--viewer-text, #e7edf5);
  --diffs-font-family: var(--code-font-family, "Iosevka", ui-monospace, monospace);
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
[data-line-number-content] { min-width: 1ch !important; }
[data-char][role="button"] { cursor: pointer; }
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

const SHELL_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body { background: #0d1014; color: #e7edf5; }
.diff-shell { position: relative; width: 100%; height: 100%; overflow: hidden; }
.code-view { width: 100%; height: 100%; overflow: auto; }
.banner { padding: 7px 10px; background: #312815; color: #eabf62; font: 12px system-ui; }
.fallback { width: 100%; height: 100%; overflow: auto; background: #0d1014; color: #e7edf5; }
.fallback-message { padding: 8px 10px; background: #321a1e; color: #ffb4b8; font: 12px system-ui; }
.fallback pre { margin: 0; padding: 10px; font: inherit; white-space: pre; }
.fallback.wrap pre { white-space: pre-wrap; overflow-wrap: anywhere; }
`;

function hunkTarget(diff: DiffDomProps["diff"], hunkIndex: number): ViewerLineTarget | null {
	const hunk = diff.hunks[hunkIndex];
	if (!hunk) return null;
	const firstLine = hunk.lines.find(
		(line) => line.kind !== "metadata" && (line.newLine !== null || line.oldLine !== null),
	);
	if (firstLine?.newLine !== null && firstLine?.newLine !== undefined) {
		return { align: "start", lineNumber: firstLine.newLine, side: "new" };
	}
	if (firstLine?.oldLine !== null && firstLine?.oldLine !== undefined) {
		return { align: "start", lineNumber: firstLine.oldLine, side: "old" };
	}
	if (hunk.newLines > 0) return { align: "start", lineNumber: hunk.newStart, side: "new" };
	if (hunk.oldLines > 0) return { align: "start", lineNumber: hunk.oldStart, side: "old" };
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
	for (const element of root.querySelectorAll<HTMLElement>("[data-column-number], [data-char]")) {
		element.onkeydown = null;
		element.removeAttribute("role");
		element.removeAttribute("tabindex");
		element.removeAttribute("aria-label");
		element.removeAttribute("title");
	}
	if (phase === "unmount") return;
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
		align: target.align ?? "nearest",
		behavior: target.behavior ?? "smooth",
		id: diffId,
		lineNumber: target.lineNumber,
		side: toPierreSide(target.side),
		type: "line",
	};
}

export default function DiffDomView({
	command,
	diff,
	fontFamily,
	fontSize,
	interactive,
	lineHeightAdjustment,
	lineNumbersVisible,
	lineWrapEnabled,
	onIdentifierClick,
	onVisibleLineChange,
	themeType,
	widthAdjustment,
}: DiffDomProps) {
	const codeViewRef = useRef<CodeViewHandle<never>>(null);
	const scrollFrameRef = useRef<number | null>(null);
	const pendingAnchorRef = useRef<{ lineNumber: number; side: "old" | "new" } | null>(null);
	const adapted = useMemo(() => {
		try {
			return { error: null, value: adaptFileDiff(diff) };
		} catch (error) {
			return {
				error: error instanceof Error ? error : new Error("The patch could not be parsed."),
				value: null,
			};
		}
	}, [diff]);
	const lineHeight = Math.max(
		4,
		fontSize * DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER + lineHeightAdjustment,
	);
	const items = useMemo<CodeViewItem<never>[]>(
		() =>
			adapted.value ? [{ fileDiff: adapted.value.fileDiff, id: diff.fileId, type: "diff" }] : [],
		[adapted.value, diff.fileId],
	);
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
				if (pending) void onVisibleLineChange(pending.lineNumber, pending.side);
			});
		},
		[diff.fileId, onVisibleLineChange],
	);
	useEffect(
		() => () => {
			if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
		},
		[],
	);
	useEffect(() => {
		if (!command) return;
		if (command.type === "top") {
			codeViewRef.current?.scrollTo({ position: 0, type: "position" });
			return;
		}
		const target = command.type === "hunk" ? hunkTarget(diff, command.hunkIndex) : command.target;
		if (target) codeViewRef.current?.scrollTo(toScrollTarget(diff.fileId, target));
	}, [command, diff]);
	const options = useMemo<CodeViewOptions<never>>(
		() => ({
			diffIndicators: "bars",
			diffStyle: "unified",
			disableFileHeader: true,
			disableLineNumbers: !lineNumbersVisible,
			enableLineSelection: false,
			expandUnchanged: true,
			hunkSeparators: "metadata",
			itemMetrics: { lineHeight, paddingBottom: 0, paddingTop: 0 },
			layout: { gap: 0, paddingBottom: 0, paddingTop: 0 },
			lineDiffType: "word-alt",
			lineHoverHighlight: "line",
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
			onTokenClick(props) {
				if (interactive && props.type === "token" && IDENTIFIER_PATTERN.test(props.tokenText)) {
					void onIdentifierClick(props.tokenText);
				}
			},
			overflow: lineWrapEnabled ? "wrap" : "scroll",
			theme: DEFAULT_THEMES,
			themeType,
			tokenizeMaxLength: 100_000,
			tokenizeMaxLineLength: 2_000,
			unsafeCSS: PIERRE_UNSAFE_CSS,
			useTokenTransformer: true,
		}),
		[
			fontFamily,
			fontSize,
			interactive,
			lineHeight,
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
			<>
				<style>{SHELL_CSS}</style>
				<div className={`fallback ${lineWrapEnabled ? "wrap" : ""}`} role="alert">
					<div className="fallback-message">
						Syntax rendering failed: {adapted.error?.message ?? "invalid patch"}. Showing plain
						text.
					</div>
					<pre>{patch}</pre>
				</div>
			</>
		);
	}
	return (
		<>
			<style>{SHELL_CSS}</style>
			<div className="diff-shell">
				{diff.tooLarge ? <div className="banner">Showing the bounded diff preview.</div> : null}
				{diff.fullFilePatch === null && !diff.tooLarge ? (
					<div className="banner">Complete file is too large; showing diff hunks.</div>
				) : null}
				<CodeView<never>
					className="code-view"
					items={items}
					onScroll={handleScroll}
					options={options}
					ref={codeViewRef}
					style={
						{
							"--diffs-font-family": fontFamily,
							"--diffs-font-size": `${fontSize}px`,
							"--diffs-letter-spacing": `${widthAdjustment}px`,
							"--diffs-line-height": `${lineHeight}px`,
							WebkitTextSizeAdjust: "100%",
							textSizeAdjust: "100%",
						} as CSSProperties
					}
				/>
			</div>
		</>
	);
}
