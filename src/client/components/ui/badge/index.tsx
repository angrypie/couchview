import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

import { Icon, type IconTone, type LucideIcon } from "../icon";
import { Text } from "../text";

const badgeStyle = tva({
	base: "self-start flex-row items-center gap-1 rounded-full px-2 py-0.5",
	defaultVariants: { variant: "neutral" },
	variants: {
		variant: {
			destructive: "bg-destructive",
			neutral: "bg-muted",
			outline: "border border-border bg-transparent",
			primary: "bg-primary",
			success: "bg-success",
			warning: "bg-warning",
		},
	},
});

const badgeTextStyle = tva({
	base: "text-xs font-semibold",
	defaultVariants: { variant: "neutral" },
	variants: {
		variant: {
			destructive: "text-destructive-foreground",
			neutral: "text-muted-foreground",
			outline: "text-foreground",
			primary: "text-primary-foreground",
			success: "text-success-foreground",
			warning: "text-warning-foreground",
		},
	},
});

const badgeIconTone = {
	destructive: "destructive-foreground",
	neutral: "muted",
	outline: "foreground",
	primary: "primary-foreground",
	success: "success-foreground",
	warning: "warning-foreground",
} as const satisfies Record<string, IconTone>;

type BadgeProps = ViewProps &
	VariantProps<typeof badgeStyle> & {
		children: ReactNode;
		icon?: LucideIcon;
	};

function Badge({ children, className, icon, variant = "neutral", ...props }: BadgeProps) {
	return (
		<View className={badgeStyle({ class: className, variant })} {...props}>
			{icon ? <Icon as={icon} size={12} tone={badgeIconTone[variant ?? "neutral"]} /> : null}
			<Text className={badgeTextStyle({ variant })}>{children}</Text>
		</View>
	);
}

export { Badge, type BadgeProps };
