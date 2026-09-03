import { type CSSProperties, type KeyboardEvent, memo } from "react";

import type { DiffRowViewProps } from "./DiffRowView.tsx";
import type { TokenRun } from "./engine/types.ts";

export type { DiffRowLayout, DiffRowViewProps } from "./DiffRowView.tsx";

const SYSTEM_FONT_FAMILY =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function DeletionIndicatorBar({
	height,
	layout,
}: Pick<DiffRowViewProps, "layout"> & { height: number }) {
	const bands = Math.max(1, Math.ceil(height / 2));
	const redBands: React.ReactNode[] = [];
	for (let index = 1; index < bands; index += 2) {
		redBands.push(
			<rect
				fill={layout.deletionIndicatorColor}
				height={2}
				key={index}
				width={4}
				x={0}
				y={index * 2}
			/>,
		);
	}
	return (
		<svg
			aria-hidden="true"
			height={height}
			style={{ display: "block", left: 0, position: "absolute", top: 0 }}
			width={4}
		>
			<rect fill={layout.deletionIndicatorBackground} height={height} width={4} x={0} y={0} />
			{redBands}
		</svg>
	);
}

function runTextStyle(layout: DiffRowViewProps["layout"], run: TokenRun): CSSProperties {
	return {
		backgroundColor: run.backgroundColor ?? undefined,
		color: run.color,
		fontFamily: layout.fontFamily,
		fontSize: layout.fontSize,
		fontStyle: run.italic ? "italic" : "normal",
		fontWeight: run.bold ? 700 : 400,
		letterSpacing: layout.letterSpacing,
		textDecorationLine: run.underline ? "underline" : "none",
	};
}

function activateIdentifier(event: KeyboardEvent<HTMLSpanElement>, activate: () => void): void {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	activate();
}

function TokenRuns({
	interactive,
	layout,
	onIdentifierPress,
	rowIndex,
	tokens,
}: Pick<DiffRowViewProps, "interactive" | "layout" | "onIdentifierPress" | "rowIndex"> & {
	tokens: readonly TokenRun[];
}) {
	let column = 0;
	return tokens.map((run, index) => {
		const runColumn = column;
		column += run.text.length;
		const style = runTextStyle(layout, run);
		if (!run.identifier || !interactive) {
			return (
				<span key={index} style={style}>
					{run.text}
				</span>
			);
		}
		const activate = () => onIdentifierPress(rowIndex, runColumn);
		return (
			<span
				aria-label={`Find “${run.text}” in project`}
				data-identifier=""
				key={index}
				onClick={activate}
				onKeyDown={(event) => activateIdentifier(event, activate)}
				role="button"
				style={style}
				tabIndex={0}
			>
				{run.text}
			</span>
		);
	});
}

function SeparatorRow({ layout, row }: Pick<DiffRowViewProps, "layout" | "row">) {
	return (
		<div
			data-separator=""
			style={{
				alignItems: "center",
				backgroundColor: layout.separatorBackground,
				boxSizing: "border-box",
				display: "flex",
				flexDirection: "row",
				flexShrink: 0,
				height: layout.separatorHeight,
				position: "relative",
				width: "100%",
			}}
		>
			<div style={{ boxSizing: "border-box", flexShrink: 0, width: layout.gutterWidth }} />
			<div
				dir="auto"
				style={{
					color: layout.separatorTextColor,
					flex: 1,
					fontFamily: SYSTEM_FONT_FAMILY,
					fontSize: layout.fontSize,
					letterSpacing: layout.letterSpacing,
					maxWidth: "100%",
					overflow: "hidden",
					paddingLeft: layout.contentPadding,
					paddingRight: layout.contentPadding,
					position: "relative",
					textOverflow: "ellipsis",
					userSelect: "text",
					whiteSpace: "nowrap",
					wordWrap: "normal",
				}}
			>
				{row.text}
			</div>
		</div>
	);
}

function LineNumber({
	layout,
	numberTestId,
	row,
}: Pick<DiffRowViewProps, "layout" | "row"> & { numberTestId: string }) {
	return (
		<div
			style={{
				alignItems: "flex-end",
				boxSizing: "border-box",
				display: "flex",
				flex: 1,
				flexDirection: "column",
				justifyContent: "flex-start",
				paddingLeft: layout.gutterPadding,
				paddingRight: layout.gutterPadding,
			}}
		>
			<div
				data-testid={numberTestId}
				dir="auto"
				style={{
					color: row.numberColor,
					fontFamily: layout.fontFamily,
					fontSize: layout.fontSize,
					letterSpacing: layout.letterSpacing,
					lineHeight: `${layout.lineHeight}px`,
				}}
			>
				{row.lineNumber}
			</div>
		</div>
	);
}

function DiffRowViewInner({
	interactive,
	layout,
	onIdentifierPress,
	row,
	rowIndex,
	tokens,
}: DiffRowViewProps) {
	if (row.kind === "separator") return <SeparatorRow layout={layout} row={row} />;

	const numberTestId =
		row.newLine !== null
			? `new-line-${row.newLine}`
			: row.oldLine !== null
				? `old-line-${row.oldLine}`
				: null;
	const lineAttributes = row.noNewline
		? { "data-no-newline": "" }
		: { "data-line": "", "data-line-kind": row.kind };

	return (
		<div
			{...lineAttributes}
			style={{
				backgroundColor: row.backgroundColor,
				boxSizing: "border-box",
				display: "flex",
				flexDirection: "row",
				flexShrink: 0,
				height: row.height,
				position: "relative",
				width: "100%",
			}}
		>
			<div
				data-column-number=""
				style={{
					backgroundColor: row.numberBackgroundColor,
					borderRightColor: layout.rowBackground,
					borderRightStyle: "solid",
					borderRightWidth: layout.gutterBorderWidth,
					boxSizing: "border-box",
					display: "flex",
					flexDirection: "column",
					flexShrink: 0,
					position: "relative",
					width: layout.gutterWidth,
				}}
			>
				{row.indicator === "addition" ? (
					<div
						style={{
							backgroundColor: layout.additionIndicatorColor,
							bottom: 0,
							left: 0,
							position: "absolute",
							top: 0,
							width: 4,
						}}
					/>
				) : row.indicator === "deletion" ? (
					<DeletionIndicatorBar height={row.height} layout={layout} />
				) : null}
				{layout.lineNumbersVisible && !row.noNewline && row.lineNumber !== null && numberTestId ? (
					<LineNumber layout={layout} numberTestId={numberTestId} row={row} />
				) : null}
			</div>
			<div
				style={{
					backgroundColor: row.backgroundColor,
					boxSizing: "border-box",
					display: "flex",
					flex: 1,
					flexDirection: "column",
					justifyContent: "flex-start",
					minWidth: 0,
					paddingLeft: layout.contentPadding,
					paddingRight: layout.contentPadding,
					position: "relative",
				}}
			>
				{row.noNewline ? (
					<div
						dir="auto"
						style={{
							color: layout.textColor,
							fontFamily: layout.fontFamily,
							fontSize: layout.fontSize,
							letterSpacing: layout.letterSpacing,
							lineHeight: `${layout.lineHeight}px`,
							opacity: 0.6,
							userSelect: "text",
						}}
					>
						{row.text}
					</div>
				) : (
					<div
						data-line-text=""
						dir="auto"
						style={{
							color: layout.textColor,
							display: "block",
							fontFamily: layout.fontFamily,
							fontSize: layout.fontSize,
							letterSpacing: layout.letterSpacing,
							lineHeight: `${layout.lineHeight}px`,
							maxWidth: layout.lineWrapEnabled ? undefined : "100%",
							overflow: layout.lineWrapEnabled ? "visible" : "hidden",
							position: "relative",
							textOverflow: layout.lineWrapEnabled ? undefined : "ellipsis",
							userSelect: "text",
							whiteSpace: layout.lineWrapEnabled ? "pre-wrap" : "pre",
							wordWrap: layout.lineWrapEnabled ? "break-word" : "normal",
						}}
					>
						{tokens === null ? (
							row.text
						) : (
							<TokenRuns
								interactive={interactive}
								layout={layout}
								onIdentifierPress={onIdentifierPress}
								rowIndex={rowIndex}
								tokens={tokens}
							/>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

export const DiffRowView = memo(
	DiffRowViewInner,
	(previous, next) =>
		previous.row === next.row &&
		previous.tokens === next.tokens &&
		previous.layout === next.layout &&
		previous.interactive === next.interactive &&
		previous.rowIndex === next.rowIndex &&
		previous.onIdentifierPress === next.onIdentifierPress,
);
