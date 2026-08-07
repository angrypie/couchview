import { tva } from "@gluestack-ui/utils/nativewind-utils";
import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

import { Icon, type LucideIcon } from "../icon";
import { Heading, Text } from "../text";

type EmptyStateProps = ViewProps & {
	action?: ReactNode;
	description?: ReactNode;
	icon?: LucideIcon;
	title: ReactNode;
};

const emptyStateStyle = tva({ base: "items-center justify-center gap-3 px-6 py-10" });

function EmptyState({ action, className, description, icon, title, ...props }: EmptyStateProps) {
	return (
		<View className={emptyStateStyle({ class: className })} {...props}>
			{icon ? (
				<View className="size-12 items-center justify-center rounded-full bg-muted">
					<Icon as={icon} size={24} tone="muted" />
				</View>
			) : null}
			<View className="max-w-md items-center gap-1">
				<Heading className="text-center" level={4}>
					{title}
				</Heading>
				{description ? (
					<Text className="text-center text-sm text-muted-foreground">{description}</Text>
				) : null}
			</View>
			{action ? <View className="pt-1">{action}</View> : null}
		</View>
	);
}

export { EmptyState, type EmptyStateProps };
