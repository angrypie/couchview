import { Pressable, View } from "react-native";

import type { ToastState } from "../features/notifications/useToastNotifications.ts";
import type { UndoReview } from "../features/review/useReviewStatus.ts";
import { Card, Text } from "./ui";

interface AppToastStackProps {
	canInstall: boolean;
	failureAvailable: boolean;
	iosInstallHint: boolean;
	onDismissInstall: () => void;
	onOpenFailure: () => void;
	onUndo: (undo: UndoReview) => void;
	onInstall: () => void;
	toast: ToastState | null;
}

function ToastAction({ label, onPress }: { label: string; onPress(): void }) {
	return (
		<Pressable
			accessibilityRole="button"
			className="rounded-md px-2 py-1 active:opacity-70"
			onPress={onPress}
		>
			<Text className="font-semibold text-primary" size="sm">
				{label}
			</Text>
		</Pressable>
	);
}

export function AppToastStack({
	canInstall,
	failureAvailable,
	iosInstallHint,
	onDismissInstall,
	onInstall,
	onOpenFailure,
	onUndo,
	toast,
}: AppToastStackProps) {
	const undo = toast?.undo;
	return (
		<View
			accessibilityLiveRegion="polite"
			className="absolute inset-x-3 bottom-safe-offset-20 z-50 gap-2"
			pointerEvents="box-none"
		>
			{toast ? (
				<Card className="flex-row items-center gap-2 bg-popover/95 py-2" key={toast.id}>
					<Text className="min-w-0 flex-1" size="sm">
						{toast.message}
					</Text>
					{undo ? <ToastAction label="Undo" onPress={() => onUndo(undo)} /> : null}
					{toast.details && failureAvailable ? (
						<ToastAction label="Details" onPress={onOpenFailure} />
					) : null}
				</Card>
			) : null}
			{canInstall ? (
				<Card className="flex-row flex-wrap items-center gap-2 bg-popover/95 py-2">
					<Text className="min-w-0 flex-1" size="sm">
						Install Couchview for full-screen access.
					</Text>
					<ToastAction label="Not now" onPress={onDismissInstall} />
					<ToastAction label="Install" onPress={onInstall} />
				</Card>
			) : null}
			{iosInstallHint && !canInstall ? (
				<Card className="flex-row items-center gap-2 bg-popover/95 py-2">
					<Text className="min-w-0 flex-1" size="sm">
						Install via Share → Add to Home Screen.
					</Text>
					<ToastAction label="Dismiss" onPress={onDismissInstall} />
				</Card>
			) : null}
		</View>
	);
}
