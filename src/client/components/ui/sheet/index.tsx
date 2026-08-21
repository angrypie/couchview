import BottomSheet from "@expo/ui/community/bottom-sheet";
import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useResolveClassNames } from "uniwind";

import { IconButton } from "../button";
import { Heading, Text } from "../text";
import "./vaulWebStyles";

type SheetPresentation = "content" | "full";
const fullSnapPoints: (string | number)[] = ["100%"];

type SheetProps = {
	children?: ReactNode;
	description?: ReactNode;
	dismissible?: boolean;
	footer?: ReactNode;
	onOpenChange(open: boolean): void;
	open: boolean;
	presentation?: SheetPresentation;
	testID?: string;
	title?: ReactNode;
};

function Sheet({
	children,
	description,
	dismissible = true,
	footer,
	onOpenChange,
	open,
	presentation = "content",
	testID,
	title,
}: SheetProps) {
	const backgroundStyle = useResolveClassNames("bg-popover");
	const full = presentation === "full";
	const close = () => {
		if (dismissible) onOpenChange(false);
	};
	const handleClosed = () => {
		if (open) onOpenChange(false);
	};

	return (
		<BottomSheet
			backgroundStyle={backgroundStyle}
			enableDynamicSizing={!full}
			enablePanDownToClose={dismissible}
			index={open ? 0 : -1}
			onClose={handleClosed}
			snapPoints={full ? fullSnapPoints : undefined}
		>
			<View
				accessibilityLabel={typeof title === "string" ? title : undefined}
				accessibilityViewIsModal
				className={
					full
						? "flex-1 gap-4 px-4 pb-safe"
						: "w-full gap-4 px-4 pb-safe web:max-h-[calc(100vh-4rem)]"
				}
				role="dialog"
				testID={testID}
			>
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
				{children ? (
					<View
						className={
							full ? "min-h-0 flex-1 gap-2" : "min-h-0 shrink gap-2 web:grow web:overflow-y-auto"
						}
					>
						{children}
					</View>
				) : null}
				{footer ? <View className="flex-row flex-wrap justify-end gap-2">{footer}</View> : null}
			</View>
		</BottomSheet>
	);
}

export { Sheet, type SheetPresentation, type SheetProps };
