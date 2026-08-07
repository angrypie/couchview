import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Modal, type ModalProps, Pressable, View } from "react-native";

import { IconButton } from "../button";
import { Heading, Text } from "../text";

type SheetProps = Pick<ModalProps, "animationType" | "onShow" | "statusBarTranslucent"> & {
	children?: ReactNode;
	description?: ReactNode;
	dismissible?: boolean;
	footer?: ReactNode;
	onOpenChange(open: boolean): void;
	open: boolean;
	testID?: string;
	title?: ReactNode;
};

function Sheet({
	animationType = "slide",
	children,
	description,
	dismissible = true,
	footer,
	onOpenChange,
	open,
	testID,
	title,
	...modalProps
}: SheetProps) {
	const close = () => {
		if (dismissible) onOpenChange(false);
	};

	return (
		<Modal
			animationType={animationType}
			onRequestClose={close}
			transparent
			visible={open}
			{...modalProps}
		>
			<View className="flex-1 justify-end" testID={testID}>
				<Pressable
					accessibilityLabel="Close sheet"
					accessibilityRole="button"
					accessible={dismissible}
					className="absolute inset-0 bg-scrim"
					disabled={!dismissible}
					onPress={close}
				/>
				<View
					accessibilityLabel={typeof title === "string" ? title : undefined}
					accessibilityViewIsModal
					className="max-h-[92%] w-full gap-4 overflow-hidden rounded-t-3xl border-x border-t border-border bg-popover p-4 pb-safe shadow-xl"
					role="dialog"
				>
					<View className="self-center h-1 w-10 rounded-full bg-muted-foreground/40" />
					{title || description || dismissible ? (
						<View className="flex-row items-start gap-3">
							<View className="min-w-0 flex-1 gap-1">
								{title ? <Heading level={3}>{title}</Heading> : null}
								{description ? (
									<Text className="text-sm text-muted-foreground">{description}</Text>
								) : null}
							</View>
							{dismissible ? (
								<IconButton accessibilityLabel="Close sheet" icon={X} onPress={close} size="sm" />
							) : null}
						</View>
					) : null}
					{children ? <View className="min-h-0 shrink gap-2">{children}</View> : null}
					{footer ? <View className="flex-row flex-wrap justify-end gap-2">{footer}</View> : null}
				</View>
			</View>
		</Modal>
	);
}

export { Sheet, type SheetProps };
