import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { View } from "react-native";

import type { FileDiff } from "../shared/contracts.ts";
import type { ResolvedTheme } from "../shared/theme.ts";
import type { DiffDomCommand, DiffDomCommandInput } from "./components/diff/diff-dom-contract.ts";
import DiffDomView from "./components/diff/diff-dom-view.tsx";
import type { DiffViewerHandle, ViewerLineTarget } from "./features/review/types.ts";

export type { DiffViewerHandle, ViewerLineTarget };

interface DiffViewerProps {
	diff: FileDiff;
	fontFamily: string;
	fontSize: number;
	interactive?: boolean;
	lineHeightAdjustment: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	onIdentifierClick(identifier: string): void;
	onVisibleLineChange(lineNumber: number, side: "old" | "new"): void;
	themeType?: ResolvedTheme;
	widthAdjustment: number;
}

export const DiffViewer = forwardRef<DiffViewerHandle, DiffViewerProps>(function DiffViewer(
	{
		diff,
		fontFamily,
		fontSize,
		interactive = true,
		lineHeightAdjustment,
		lineNumbersVisible,
		lineWrapEnabled,
		onIdentifierClick,
		onVisibleLineChange,
		themeType = "dark",
		widthAdjustment,
	},
	ref,
) {
	const [command, setCommand] = useState<DiffDomCommand | null>(null);
	const issueCommand = useCallback((next: DiffDomCommandInput) => {
		setCommand(
			(current) => ({ ...next, revision: (current?.revision ?? 0) + 1 }) as DiffDomCommand,
		);
	}, []);
	useImperativeHandle(
		ref,
		() => ({
			scrollToHunk: (hunkIndex) => issueCommand({ hunkIndex, type: "hunk" }),
			scrollToLine: (target) => issueCommand({ target, type: "line" }),
			scrollToTop: () => issueCommand({ type: "top" }),
		}),
		[issueCommand],
	);
	return (
		<View className="flex-1 overflow-hidden bg-background">
			<DiffDomView
				command={command}
				diff={diff}
				dom={{
					contentInsetAdjustmentBehavior: "never",
					scrollEnabled: false,
					style: { flex: 1 },
				}}
				fontFamily={fontFamily}
				fontSize={fontSize}
				interactive={interactive}
				lineHeightAdjustment={lineHeightAdjustment}
				lineNumbersVisible={lineNumbersVisible}
				lineWrapEnabled={lineWrapEnabled}
				onIdentifierClick={async (identifier) => onIdentifierClick(identifier)}
				onVisibleLineChange={async (lineNumber, side) => onVisibleLineChange(lineNumber, side)}
				themeType={themeType}
				widthAdjustment={widthAdjustment}
			/>
		</View>
	);
});
