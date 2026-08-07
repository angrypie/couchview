import { Modal, View } from "react-native";

import type { RestartPhase } from "../features/repositories/types.ts";
import { Heading, Spinner, Text } from "./ui";

export type { RestartPhase };

interface RestartOverlayProps {
	phase: RestartPhase;
}

export function RestartOverlay({ phase }: RestartOverlayProps) {
	return (
		<Modal animationType="fade" transparent visible={Boolean(phase)}>
			<View
				accessibilityLiveRegion="assertive"
				accessibilityRole="progressbar"
				accessibilityViewIsModal
				className="flex-1 items-center justify-center gap-3 bg-scrim p-6"
			>
				<View className="w-full max-w-md items-center gap-3 rounded-2xl border border-border bg-popover p-6 shadow-xl">
					<Spinner size="large" />
					<Heading className="text-center" level={2}>
						{phase === "building"
							? "Building Couchview…"
							: phase === "restarting"
								? "Restarting Couchview…"
								: "Loading the new build…"}
					</Heading>
					<Text className="text-center text-muted-foreground" size="sm">
						Keep this page open. Your repository selection and review state will be restored.
					</Text>
				</View>
			</View>
		</Modal>
	);
}
