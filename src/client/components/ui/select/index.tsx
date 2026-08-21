import { tva } from "@gluestack-ui/utils/nativewind-utils";
import { Check, ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { Pressable, type PressableProps, View } from "react-native";

import { Icon } from "../icon";
import { ListItem } from "../list-item";
import { Sheet } from "../sheet";
import { Text } from "../text";

interface SelectOption {
	description?: string;
	disabled?: boolean;
	label: string;
	value: string;
}

const selectStyle = tva({
	base: "min-h-10 w-full flex-row items-center gap-2 rounded-md border bg-background px-3 active:opacity-80 disabled:opacity-50",
	variants: { invalid: { false: "border-border", true: "border-destructive" } },
});

type SelectProps = Omit<PressableProps, "children" | "onPress"> & {
	error?: string;
	label?: string;
	onValueChange(value: string): void;
	options: readonly SelectOption[];
	placeholder?: string;
	value?: string;
};

function Select({
	accessibilityLabel,
	className,
	disabled,
	error,
	label,
	onValueChange,
	options,
	placeholder = "Select an option",
	value,
	...props
}: SelectProps) {
	const [open, setOpen] = useState(false);
	const selected = options.find((option) => option.value === value);
	const choose = (nextValue: string) => {
		onValueChange(nextValue);
		setOpen(false);
	};

	return (
		<View className="gap-1.5">
			{label ? <Text className="text-sm font-medium">{label}</Text> : null}
			<Pressable
				accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
				accessibilityRole="button"
				accessibilityState={{ disabled: Boolean(disabled), expanded: open }}
				className={selectStyle({ class: className, invalid: Boolean(error) })}
				disabled={disabled}
				onPress={() => setOpen(true)}
				{...props}
			>
				<Text className={selected ? "min-w-0 flex-1" : "min-w-0 flex-1 text-muted-foreground"}>
					{selected?.label ?? placeholder}
				</Text>
				<Icon as={ChevronDown} size={18} tone="muted" />
			</Pressable>
			{error ? (
				<Text accessibilityRole="alert" className="text-xs text-destructive">
					{error}
				</Text>
			) : null}
			<Sheet onOpenChange={setOpen} open={open} title={label ?? accessibilityLabel ?? placeholder}>
				<View className="gap-1">
					{options.map((option) => (
						<ListItem
							disabled={option.disabled}
							key={option.value}
							onPress={() => choose(option.value)}
							selected={option.value === value}
							subtitle={option.description}
							title={option.label}
							trailing={
								option.value === value ? <Icon as={Check} size={18} tone="primary" /> : null
							}
						/>
					))}
				</View>
			</Sheet>
		</View>
	);
}

export { Select, type SelectOption, type SelectProps };
