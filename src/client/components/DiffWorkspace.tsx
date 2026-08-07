import { AlertTriangle, CheckCircle2, FileCode2, RefreshCw } from "lucide-react-native";
import type { ReactNode, RefObject } from "react";
import { ScrollView, View } from "react-native";

import type { FileDiff } from "../../shared/contracts.ts";
import type { TypographyPreferences } from "../../shared/settings.ts";
import type { ResolvedTheme } from "../../shared/theme.ts";
import { DiffViewer, type DiffViewerHandle } from "../DiffViewer.tsx";
import { codeFontStack } from "../typographyPreferences.ts";
import { Button, EmptyState, Spinner, Text } from "./ui";

interface DiffWorkspaceProps {
	diff: FileDiff | null;
	diffError: string;
	diffLoading: boolean;
	failureAvailable: boolean;
	fileCount: number;
	fontSize: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	onIdentifierClick: (identifier: string) => void;
	onOpenFailure: () => void;
	onRetry: () => void;
	onVisibleLineChange: (lineNumber: number, side: "old" | "new") => void;
	rowCount: number;
	retryAvailable: boolean;
	themeType: ResolvedTheme;
	typography: TypographyPreferences["diff"];
	viewerRef: RefObject<DiffViewerHandle | null>;
}

function MetadataPreview({ children }: { children: ReactNode }) {
	return (
		<ScrollView
			className="max-h-44 max-w-full rounded-lg border border-border bg-muted"
			contentContainerClassName="p-3"
			horizontal
		>
			<Text className="font-mono text-xs" selectable>
				{children}
			</Text>
		</ScrollView>
	);
}

export function DiffWorkspace({
	diff,
	diffError,
	diffLoading,
	failureAvailable,
	fileCount,
	fontSize,
	lineNumbersVisible,
	lineWrapEnabled,
	onIdentifierClick,
	onOpenFailure,
	onRetry,
	onVisibleLineChange,
	rowCount,
	retryAvailable,
	themeType,
	typography,
	viewerRef,
}: DiffWorkspaceProps) {
	let content: ReactNode = null;
	if (fileCount === 0) {
		content = (
			<EmptyState
				description="New changes will appear here automatically."
				icon={CheckCircle2}
				title="Working tree is clean"
			/>
		);
	} else if (diffLoading && !diff) {
		content = (
			<View className="flex-1 items-center justify-center gap-3 p-6">
				<Spinner accessibilityLabel="Loading diff" size="large" />
				<Text className="text-muted-foreground">Loading diff…</Text>
			</View>
		);
	} else if (diffError && !diff) {
		content = (
			<EmptyState
				action={
					<View className="flex-row flex-wrap justify-center gap-2">
						{failureAvailable ? (
							<Button onPress={onOpenFailure} variant="outline">
								Error details
							</Button>
						) : null}
						{retryAvailable ? (
							<Button leftIcon={RefreshCw} onPress={onRetry} variant="outline">
								Retry
							</Button>
						) : null}
					</View>
				}
				description={diffError}
				icon={AlertTriangle}
				title="Couldn’t load this diff"
			/>
		);
	} else if (diff?.binary) {
		content = (
			<EmptyState
				action={
					diff.header.length > 0 ? (
						<MetadataPreview>{diff.header.join("\n")}</MetadataPreview>
					) : null
				}
				description="A line-by-line preview isn’t available for this change."
				icon={FileCode2}
				title="Binary file"
			/>
		);
	} else if (diff?.tooLarge && rowCount === 0) {
		content = (
			<EmptyState
				description="Review this file using your local Git tools."
				icon={AlertTriangle}
				title="Diff is too large to display"
			/>
		);
	} else if (rowCount === 0) {
		content = (
			<EmptyState
				action={
					diff?.header.length ? <MetadataPreview>{diff.header.join("\n")}</MetadataPreview> : null
				}
				description="Review the file metadata below."
				icon={FileCode2}
				title="No textual hunks"
			/>
		);
	} else if (diff) {
		content = (
			<DiffViewer
				diff={diff}
				fontFamily={codeFontStack(typography.fontFamily)}
				fontSize={fontSize}
				lineHeightAdjustment={typography.lineHeightAdjustment}
				lineNumbersVisible={lineNumbersVisible}
				lineWrapEnabled={lineWrapEnabled}
				onIdentifierClick={onIdentifierClick}
				onVisibleLineChange={onVisibleLineChange}
				ref={viewerRef}
				themeType={themeType}
				widthAdjustment={typography.widthAdjustment}
			/>
		);
	}

	return (
		<View
			accessibilityLabel="Unified diff"
			className="relative min-h-0 flex-1 overflow-hidden bg-background"
			role="region"
		>
			{content}
			{diffLoading && diff ? (
				<View
					accessibilityLiveRegion="polite"
					className="absolute right-3 top-3 flex-row items-center gap-2 rounded-full border border-border bg-popover px-3 py-1.5 shadow-sm"
					role="status"
				>
					<Spinner accessibilityLabel="Refreshing diff" size="small" />
					<Text className="text-xs text-muted-foreground">Refreshing diff…</Text>
				</View>
			) : null}
		</View>
	);
}
