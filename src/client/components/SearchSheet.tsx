import { Search } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";

import type { SearchMatch, SearchResponse } from "../../shared/contracts.ts";
import type { SearchScope } from "../features/search/useRepositorySearch.ts";
import { HighlightedMatch } from "./HighlightedMatch.tsx";
import { SpeechInput } from "./speech";
import { EmptyState, Sheet, Spinner, Text } from "./ui";

interface SearchSheetProps {
	busy: boolean;
	onClose: () => void;
	onQueryChange: (query: string) => void;
	onScopeChange: (scope: SearchScope) => void;
	onSelectMatch: (match: SearchMatch) => void;
	open: boolean;
	query: string;
	result: SearchResponse | null;
	scope: SearchScope;
}

function ScopeButton(props: { active: boolean; label: string; onPress(): void }) {
	return (
		<Pressable
			accessibilityRole="tab"
			accessibilityState={{ selected: props.active }}
			className={`min-h-9 flex-1 items-center justify-center rounded-md px-2 ${
				props.active ? "bg-primary" : "bg-transparent"
			}`}
			onPress={props.onPress}
		>
			<Text
				className={props.active ? "text-primary-foreground" : "text-muted-foreground"}
				size="xs"
			>
				{props.label}
			</Text>
		</Pressable>
	);
}

export function SearchSheet({
	busy,
	onClose,
	onQueryChange,
	onScopeChange,
	onSelectMatch,
	open,
	query,
	result,
	scope,
}: SearchSheetProps) {
	const activeMatches = scope === "current" ? result?.currentFile : result?.otherFiles;
	return (
		<Sheet
			description="Tap any code word to search"
			footer={
				<Text className="text-muted-foreground" size="xs">
					{result?.truncated ? "Showing the first matches" : "Searches tracked project files"}
				</Text>
			}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
			open={open}
			title="Find in project"
		>
			<SpeechInput
				accessibilityLabel="Search project"
				autoCapitalize="none"
				autoCorrect={false}
				onChangeText={onQueryChange}
				placeholder="Search project"
				returnKeyType="search"
				value={query}
			/>
			<View accessibilityRole="tablist" className="flex-row rounded-lg bg-muted p-1">
				<ScopeButton
					active={scope === "current"}
					label={`Current file (${result?.currentFile.length ?? 0})`}
					onPress={() => onScopeChange("current")}
				/>
				<ScopeButton
					active={scope === "other"}
					label={`Other files (${result?.otherFiles.length ?? 0})`}
					onPress={() => onScopeChange("other")}
				/>
			</View>
			<ScrollView className="max-h-[52vh]" contentContainerClassName="gap-1">
				{busy ? (
					<View className="min-h-36 items-center justify-center">
						<Spinner />
					</View>
				) : query.trim().length < 1 ? (
					<EmptyState icon={Search} title="Enter a search term" />
				) : activeMatches?.length ? (
					activeMatches.map((match) => (
						<Pressable
							accessibilityLabel={`${match.path}:${match.line}:${match.column}`}
							accessibilityRole="button"
							className="gap-1 rounded-lg px-3 py-2 active:bg-muted"
							key={`${match.path}:${match.line}:${match.column}`}
							onPress={() => onSelectMatch(match)}
						>
							<Text className="font-mono text-muted-foreground" size="xs">
								{match.path}:{match.line}:{match.column}
							</Text>
							<HighlightedMatch query={query} text={match.preview} />
						</Pressable>
					))
				) : (
					<EmptyState icon={Search} title="No matches in this scope" />
				)}
			</ScrollView>
		</Sheet>
	);
}
