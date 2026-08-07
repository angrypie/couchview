import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { ScrollView, type ScrollViewProps } from "react-native";
import {
	SafeAreaView as NativeSafeAreaView,
	type SafeAreaViewProps,
} from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

const SafeAreaView = withUniwind(NativeSafeAreaView);

const screenStyle = tva({
	base: "flex-1 bg-background",
	defaultVariants: { padding: "none" },
	variants: {
		padding: {
			lg: "p-6",
			md: "p-4",
			none: "p-0",
			sm: "p-3",
		},
	},
});

const safeAreaStyle = tva({ base: "flex-1 bg-background" });
const scrollStyle = tva({ base: "flex-1" });
const scrollContentStyle = tva({ base: "grow p-4" });

type ScreenProps = SafeAreaViewProps & VariantProps<typeof screenStyle>;

const Screen = React.forwardRef<React.ComponentRef<typeof NativeSafeAreaView>, ScreenProps>(
	function Screen({ className, padding = "none", ...props }, ref) {
		return (
			<SafeAreaView className={screenStyle({ class: className, padding })} ref={ref} {...props} />
		);
	},
);

Screen.displayName = "Screen";

type ScrollScreenProps = ScrollViewProps & {
	contentContainerClassName?: string;
	safeAreaClassName?: string;
};

const ScrollScreen = React.forwardRef<React.ComponentRef<typeof ScrollView>, ScrollScreenProps>(
	function ScrollScreen(
		{
			className,
			contentContainerClassName,
			contentInsetAdjustmentBehavior = "automatic",
			safeAreaClassName,
			...props
		},
		ref,
	) {
		return (
			<SafeAreaView className={safeAreaStyle({ class: safeAreaClassName })}>
				<ScrollView
					className={scrollStyle({ class: className })}
					contentContainerClassName={scrollContentStyle({ class: contentContainerClassName })}
					contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
					ref={ref}
					{...props}
				/>
			</SafeAreaView>
		);
	},
);

ScrollScreen.displayName = "ScrollScreen";

export { Screen, type ScreenProps, ScrollScreen, type ScrollScreenProps };
