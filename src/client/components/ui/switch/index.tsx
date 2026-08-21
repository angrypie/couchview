import { tva } from "@gluestack-ui/utils/nativewind-utils";
import React, { type ReactNode } from "react";
import { Switch as NativeSwitch, type SwitchProps as NativeSwitchProps, View } from "react-native";

import { Text } from "../text";

type SwitchProps = Omit<
	NativeSwitchProps,
	| "ios_backgroundColor"
	| "ios_backgroundColorClassName"
	| "thumbColor"
	| "thumbColorClassName"
	| "trackColor"
	| "trackColorOffClassName"
	| "trackColorOnClassName"
> & {
	containerClassName?: string;
	description?: ReactNode;
	label?: ReactNode;
};

const switchContainerStyle = tva({ base: "flex-row items-center justify-between gap-3" });

const Switch = React.forwardRef<React.ComponentRef<typeof NativeSwitch>, SwitchProps>(
	function Switch(
		{ accessibilityLabel, containerClassName, description, disabled, label, ...props },
		ref,
	) {
		return (
			<View className={switchContainerStyle({ class: containerClassName })}>
				{label || description ? (
					<View className="min-w-0 flex-1 gap-0.5">
						{label ? <Text>{label}</Text> : null}
						{description ? (
							<Text className="text-sm text-muted-foreground">{description}</Text>
						) : null}
					</View>
				) : null}
				<NativeSwitch
					accessibilityLabel={accessibilityLabel ?? (typeof label === "string" ? label : undefined)}
					disabled={disabled}
					ios_backgroundColorClassName="accent-border"
					ref={ref}
					thumbColorClassName="accent-primary-foreground"
					trackColorOffClassName="accent-border"
					trackColorOnClassName="accent-primary"
					{...props}
				/>
			</View>
		);
	},
);

Switch.displayName = "Switch";

export { Switch, type SwitchProps };
