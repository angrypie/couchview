"use client";

import { UIIcon } from "@gluestack-ui/core/icon/creator";
import { createInput } from "@gluestack-ui/core/input/creator";
import { tva, type VariantProps, withStyleContext } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { Pressable, TextInput, View } from "react-native";
import { withUniwind } from "uniwind";

const INPUT_SCOPE = "INPUT";
const StyledUIIcon = withUniwind(UIIcon);
const UIInput = createInput({
	Icon: StyledUIIcon,
	Input: TextInput,
	Root: withStyleContext(View, INPUT_SCOPE),
	Slot: Pressable,
});

const inputStyle = tva({
	base: "min-h-10 w-full flex-row items-center gap-2 overflow-hidden rounded-md border border-border bg-background px-3 shadow-xs data-[disabled=true]:opacity-50 data-[focus=true]:border-ring data-[invalid=true]:border-destructive web:data-[focus=true]:ring-2 web:data-[focus=true]:ring-ring/50",
});

const inputFieldStyle = tva({
	base: "h-full flex-1 py-2 text-base text-foreground ios:leading-[0px] web:cursor-text web:outline-none web:data-[disabled=true]:cursor-not-allowed",
});

type InputProps = React.ComponentPropsWithoutRef<typeof UIInput> &
	VariantProps<typeof inputStyle> & { className?: string };

const Input = React.forwardRef<React.ComponentRef<typeof UIInput>, InputProps>(function Input(
	{ className, ...props },
	ref,
) {
	return <UIInput className={inputStyle({ class: className })} context={{}} ref={ref} {...props} />;
});

type InputFieldProps = React.ComponentPropsWithoutRef<typeof UIInput.Input> &
	VariantProps<typeof inputFieldStyle> & { className?: string };

const InputField = React.forwardRef<React.ComponentRef<typeof UIInput.Input>, InputFieldProps>(
	function InputField(
		{ className, placeholderTextColorClassName = "accent-muted-foreground", ...props },
		ref,
	) {
		return (
			<UIInput.Input
				className={inputFieldStyle({ class: className })}
				placeholderTextColorClassName={placeholderTextColorClassName}
				ref={ref}
				{...props}
			/>
		);
	},
);

Input.displayName = "Input";
InputField.displayName = "InputField";

export { Input, InputField };
