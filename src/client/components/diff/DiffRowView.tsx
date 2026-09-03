import { memo } from "react";
import { Platform, Text, type TextStyle, View, type ViewStyle } from "react-native";
import Svg, { Rect } from "react-native-svg";

import type { TokenRun } from "./engine/types.ts";
import type { DiffSceneLayout, DiffSceneRow } from "./scene/types.ts";

export type DiffRowLayout = DiffSceneLayout;

export interface DiffRowViewProps {
	interactive: boolean;
	layout: DiffRowLayout;
	onIdentifierPress: (rowIndex: number, column: number) => void;
	row: DiffSceneRow;
	rowIndex: number;
	tokens: readonly TokenRun[] | null;
}

function rowWebProps(row: DiffSceneRow) {
	if (Platform.OS !== "web") return {};
	return row.noNewline
		? { dataSet: { noNewline: "" } }
		: { dataSet: { line: "", lineKind: row.kind } };
}

function DeletionIndicatorBar({ height, layout }: { height: number; layout: DiffRowLayout }) {
	const bands = Math.max(1, Math.ceil(height / 2));
	const redBands: React.ReactNode[] = [];
	for (let index = 1; index < bands; index += 2) {
		redBands.push(
			<Rect
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
		<Svg height={height} width={4}>
			<Rect fill={layout.deletionIndicatorBackground} height={height} width={4} x={0} y={0} />
			{redBands}
		</Svg>
	);
}

function runTextStyle(layout: DiffRowLayout, run: TokenRun): TextStyle {
	const style: TextStyle = {
		color: run.color,
		fontFamily: layout.fontFamily,
		fontSize: layout.fontSize,
		fontStyle: run.italic ? "italic" : "normal",
		fontWeight: run.bold ? "700" : "400",
		letterSpacing: layout.letterSpacing,
		textDecorationLine: run.underline ? "underline" : "none",
	};
	if (run.backgroundColor) style.backgroundColor = run.backgroundColor;
	return style;
}

function DiffRowViewInner({
	interactive,
	layout,
	onIdentifierPress,
	row,
	rowIndex,
	tokens,
}: DiffRowViewProps) {
	if (row.kind === "separator") {
		return (
			<View
				{...(Platform.OS === "web" ? { dataSet: { separator: "" } } : {})}
				style={{
					alignItems: "center",
					backgroundColor: layout.separatorBackground,
					flexDirection: "row",
					height: layout.separatorHeight,
					width: "100%",
				}}
			>
				<View style={{ width: layout.gutterWidth }} />
				<Text
					ellipsizeMode="tail"
					numberOfLines={1}
					selectable
					style={{
						color: layout.separatorTextColor,
						flex: 1,
						fontSize: layout.fontSize,
						letterSpacing: layout.letterSpacing,
						paddingHorizontal: layout.contentPadding,
					}}
				>
					{row.text}
				</Text>
			</View>
		);
	}

	const kind = row.kind;
	const gutterStyle: ViewStyle = {
		backgroundColor: row.numberBackgroundColor,
		borderRightColor: layout.rowBackground,
		borderRightWidth: layout.gutterBorderWidth,
		width: layout.gutterWidth,
	};
	const webProps = rowWebProps(row);
	const gutterWebProps = Platform.OS === "web" ? { dataSet: { columnNumber: "" } } : {};
	const numberTestId =
		row.newLine !== null
			? `new-line-${row.newLine}`
			: row.oldLine !== null
				? `old-line-${row.oldLine}`
				: null;

	return (
		<View
			{...webProps}
			style={{
				backgroundColor: row.backgroundColor,
				flexDirection: "row",
				height: row.height,
				width: "100%",
			}}
		>
			<View {...gutterWebProps} style={gutterStyle}>
				{kind !== "context" && !row.noNewline ? (
					<View style={{ bottom: 0, left: 0, position: "absolute", top: 0, width: 4 }}>
						{kind === "addition" ? (
							<View style={{ backgroundColor: layout.additionIndicatorColor, flex: 1 }} />
						) : (
							<DeletionIndicatorBar height={row.height} layout={layout} />
						)}
					</View>
				) : null}
				{layout.lineNumbersVisible && !row.noNewline && row.lineNumber !== null ? (
					<View
						style={{
							alignItems: "flex-end",
							flex: 1,
							justifyContent: "flex-start",
							paddingHorizontal: layout.gutterPadding,
						}}
					>
						<Text
							style={{
								color: row.numberColor,
								fontFamily: layout.fontFamily,
								fontSize: layout.fontSize,
								letterSpacing: layout.letterSpacing,
								lineHeight: layout.lineHeight,
							}}
							testID={numberTestId ?? undefined}
						>
							{row.lineNumber}
						</Text>
					</View>
				) : null}
			</View>
			<View
				style={{
					backgroundColor: row.backgroundColor,
					flex: 1,
					justifyContent: "flex-start",
					minWidth: 0,
					paddingHorizontal: layout.contentPadding,
				}}
			>
				{row.noNewline ? (
					<Text
						selectable
						style={{
							color: layout.textColor,
							fontFamily: layout.fontFamily,
							fontSize: layout.fontSize,
							letterSpacing: layout.letterSpacing,
							lineHeight: layout.lineHeight,
							opacity: 0.6,
						}}
					>
						{row.text}
					</Text>
				) : (
					<Text
						numberOfLines={layout.lineWrapEnabled ? undefined : 1}
						selectable
						style={
							{
								color: layout.textColor,
								fontFamily: layout.fontFamily,
								fontSize: layout.fontSize,
								letterSpacing: layout.letterSpacing,
								lineHeight: layout.lineHeight,
								whiteSpace: layout.lineWrapEnabled ? "pre-wrap" : "pre",
							} as TextStyle
						}
						{...(Platform.OS === "web" ? { dataSet: { lineText: "" } } : {})}
					>
						{tokens === null
							? row.text
							: (() => {
									let column = 0;
									return tokens.map((run, index) => {
										const runColumn = column;
										column += run.text.length;
										return run.identifier && interactive ? (
											<Text
												accessibilityLabel={`Find “${run.text}” in project`}
												accessibilityRole="button"
												key={`${index}:${run.text}`}
												onPress={() => onIdentifierPress(rowIndex, runColumn)}
												style={runTextStyle(layout, run)}
												{...(Platform.OS === "web"
													? ({
															dataSet: { identifier: "" },
															tabIndex: 0,
														} as Record<string, unknown>)
													: {})}
											>
												{run.text}
											</Text>
										) : (
											<Text key={`${index}:${run.text}`} style={runTextStyle(layout, run)}>
												{run.text}
											</Text>
										);
									});
								})()}
					</Text>
				)}
			</View>
		</View>
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
