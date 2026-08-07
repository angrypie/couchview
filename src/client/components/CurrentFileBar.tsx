import { Settings2 } from "lucide-react-native";
import { View } from "react-native";

import type { FileChange, FileDiff } from "../../shared/contracts.ts";
import { changeLabel, stageLabel } from "../features/staging/changeFiles.ts";
import { Badge, IconButton, Text } from "./ui";

interface CurrentFileBarProps {
	activeFile: FileChange | null;
	diff: FileDiff | null;
	onOpenSettings: () => void;
	visible: boolean;
}

export function CurrentFileBar({ activeFile, diff, onOpenSettings, visible }: CurrentFileBarProps) {
	if (!visible) return null;
	const staged = activeFile ? stageLabel(activeFile) : null;

	return (
		<View
			accessibilityLabel="Current file"
			className="min-h-12 flex-row items-center gap-3 border-b border-border bg-card px-3 py-2"
			role="region"
		>
			<View className="min-w-0 flex-1 gap-1">
				<Text className="font-mono text-sm" numberOfLines={1} selectable>
					{activeFile?.path ?? "No changed file"}
				</Text>
				{activeFile ? (
					<View className="flex-row flex-wrap items-center gap-1.5">
						<Badge variant={activeFile.conflicted ? "destructive" : "outline"}>
							{changeLabel(activeFile)}
						</Badge>
						<Text className="text-xs font-semibold text-success">
							+{activeFile.additions ?? diff?.additions ?? 0}
						</Text>
						<Text className="text-xs font-semibold text-destructive">
							−{activeFile.deletions ?? diff?.deletions ?? 0}
						</Text>
						{activeFile.reviewed ? <Badge variant="success">reviewed</Badge> : null}
						{staged ? (
							<Badge
								variant={
									staged === "staged" ? "primary" : staged === "partial" ? "warning" : "neutral"
								}
							>
								{staged}
							</Badge>
						) : null}
					</View>
				) : null}
			</View>
			<IconButton
				accessibilityLabel="Open settings"
				icon={Settings2}
				onPress={onOpenSettings}
				size="sm"
				variant="ghost"
			/>
		</View>
	);
}
