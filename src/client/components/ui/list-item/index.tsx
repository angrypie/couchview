import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React, { type ReactNode } from "react";
import { Pressable, type PressableProps, View } from "react-native";

import { Text } from "../text";

const listItemStyle = tva({
	base: "w-full flex-row items-center gap-3 rounded-xl px-3 active:opacity-80 disabled:opacity-50 web:cursor-pointer disabled:web:cursor-not-allowed",
	defaultVariants: { density: "default", tone: "default" },
	variants: {
		density: {
			compact: "min-h-10 py-2",
			comfortable: "min-h-16 py-4",
			default: "min-h-12 py-3",
		},
		selected: {
			true: "bg-accent",
		},
		tone: {
			default: "hover:bg-muted",
			destructive: "hover:bg-destructive/10",
		},
	},
});

type ListItemProps = Omit<PressableProps, "children"> &
	VariantProps<typeof listItemStyle> & {
		leading?: ReactNode;
		subtitle?: ReactNode;
		title: ReactNode;
		trailing?: ReactNode;
	};

const ListItem = React.forwardRef<React.ComponentRef<typeof Pressable>, ListItemProps>(
	function ListItem(
		{
			accessibilityState,
			className,
			density = "default",
			leading,
			onPress,
			selected,
			subtitle,
			title,
			tone = "default",
			trailing,
			...props
		},
		ref,
	) {
		return (
			<Pressable
				accessibilityRole={onPress ? "button" : undefined}
				accessibilityState={{ ...accessibilityState, selected: selected as boolean }}
				className={listItemStyle({
					class: className,
					density,
					selected: selected as boolean,
					tone,
				})}
				onPress={onPress}
				ref={ref}
				{...props}
			>
				{leading}
				<View className="min-w-0 flex-1 gap-0.5">
					<Text
						bold={selected as boolean}
						className={tone === "destructive" ? "text-destructive" : undefined}
						numberOfLines={1}
					>
						{title}
					</Text>
					{subtitle ? (
						<Text className="text-sm text-muted-foreground" numberOfLines={2}>
							{subtitle}
						</Text>
					) : null}
				</View>
				{trailing}
			</Pressable>
		);
	},
);

ListItem.displayName = "ListItem";

export { ListItem, type ListItemProps };
