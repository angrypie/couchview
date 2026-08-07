import { X } from "lucide-react-native";
import { type ReactNode, useEffect } from "react";
import { Modal, type ModalProps, Platform, Pressable, View } from "react-native";

import { IconButton } from "../button";
import { Heading, Text } from "../text";

type DialogProps = Pick<ModalProps, "animationType" | "onShow" | "statusBarTranslucent"> & {
	children?: ReactNode;
	description?: ReactNode;
	dismissible?: boolean;
	footer?: ReactNode;
	onOpenChange(open: boolean): void;
	open: boolean;
	testID?: string;
	title: ReactNode;
};

function Dialog({
	animationType = "fade",
	children,
	description,
	dismissible = true,
	footer,
	onOpenChange,
	open,
	testID,
	title,
	...modalProps
}: DialogProps) {
	const close = () => {
		if (dismissible) onOpenChange(false);
	};
	useEffect(() => {
		if (Platform.OS !== "web" || !dismissible || !open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onOpenChange(false);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [dismissible, onOpenChange, open]);

	return (
		<Modal
			animationType={animationType}
			onRequestClose={close}
			transparent
			visible={open}
			{...modalProps}
		>
			<View className="flex-1 items-center justify-center p-4" testID={testID}>
				<Pressable
					accessibilityLabel="Close dialog"
					accessibilityRole="button"
					accessible={dismissible}
					className="absolute inset-0 bg-scrim"
					disabled={!dismissible}
					onPress={close}
				/>
				<View
					accessibilityLabel={typeof title === "string" ? title : undefined}
					accessibilityViewIsModal
					className="max-h-[90%] w-full max-w-xl gap-4 rounded-2xl border border-border bg-popover p-4 shadow-xl"
					role="dialog"
				>
					<View className="flex-row items-start gap-3">
						<View className="min-w-0 flex-1 gap-1">
							<Heading level={3}>{title}</Heading>
							{description ? (
								<Text className="text-sm text-muted-foreground">{description}</Text>
							) : null}
						</View>
						{dismissible ? (
							<IconButton accessibilityLabel="Close dialog" icon={X} onPress={close} size="sm" />
						) : null}
					</View>
					{children ? <View className="gap-3">{children}</View> : null}
					{footer ? <View className="flex-row flex-wrap justify-end gap-2">{footer}</View> : null}
				</View>
			</View>
		</Modal>
	);
}

export { Dialog, type DialogProps };
