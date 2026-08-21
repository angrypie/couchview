import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import { createContext, type ReactNode, useContext } from "react";
import { Pressable, type PressableProps, View, type ViewProps } from "react-native";

import { Text } from "../text";

interface RadioGroupContextValue {
	disabled: boolean;
	onValueChange(value: string): void;
	value?: string;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

const radioGroupStyle = tva({
	base: "gap-3",
	defaultVariants: { orientation: "vertical" },
	variants: {
		orientation: {
			horizontal: "flex-row flex-wrap",
			vertical: "flex-col",
		},
	},
});

const radioStyle = tva({
	base: "flex-row items-start gap-3 rounded-lg py-1 active:opacity-80 disabled:opacity-50",
});

type RadioGroupProps = ViewProps &
	VariantProps<typeof radioGroupStyle> & {
		disabled?: boolean;
		onValueChange(value: string): void;
		value?: string;
	};

function RadioGroup({
	children,
	className,
	disabled = false,
	onValueChange,
	orientation = "vertical",
	value,
	...props
}: RadioGroupProps) {
	return (
		<RadioGroupContext value={{ disabled, onValueChange, value }}>
			<View
				accessibilityRole="radiogroup"
				className={radioGroupStyle({ class: className, orientation })}
				{...props}
			>
				{children}
			</View>
		</RadioGroupContext>
	);
}

type RadioProps = Omit<PressableProps, "children" | "onPress"> & {
	checked?: boolean;
	description?: ReactNode;
	label: ReactNode;
	onCheckedChange?(checked: boolean): void;
	value: string;
};

function Radio({
	accessibilityLabel,
	checked,
	className,
	description,
	disabled,
	label,
	onCheckedChange,
	value,
	...props
}: RadioProps) {
	const group = useContext(RadioGroupContext);
	const isChecked = checked ?? group?.value === value;
	const isDisabled = disabled || group?.disabled;
	const handlePress = () => {
		onCheckedChange?.(group ? true : !isChecked);
		group?.onValueChange(value);
	};

	return (
		<Pressable
			aria-checked={isChecked}
			accessibilityLabel={accessibilityLabel ?? (typeof label === "string" ? label : undefined)}
			accessibilityRole="radio"
			accessibilityState={{ checked: isChecked, disabled: isDisabled }}
			className={radioStyle({ class: className })}
			disabled={isDisabled}
			onPress={handlePress}
			{...props}
		>
			<View
				className={
					isChecked
						? "mt-0.5 size-5 items-center justify-center rounded-full border-2 border-primary bg-primary"
						: "mt-0.5 size-5 items-center justify-center rounded-full border-2 border-border bg-background"
				}
			>
				{isChecked ? <View className="size-2 rounded-full bg-primary-foreground" /> : null}
			</View>
			<View className="min-w-0 flex-1 gap-0.5">
				<Text>{label}</Text>
				{description ? <Text className="text-sm text-muted-foreground">{description}</Text> : null}
			</View>
		</Pressable>
	);
}

export { Radio, RadioGroup, type RadioGroupProps, type RadioProps };
