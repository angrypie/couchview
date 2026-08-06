"use client";

import { createButton } from "@gluestack-ui/core/button/creator";
import { UIIcon } from "@gluestack-ui/core/icon/creator";
import {
	tva,
	useStyleContext,
	type VariantProps,
	withStyleContext,
} from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { withUniwind } from "uniwind";

const BUTTON_SCOPE = "BUTTON";
const ButtonRoot = withStyleContext(Pressable, BUTTON_SCOPE);
const StyledUIIcon = withUniwind(UIIcon);
const UIButton = createButton({
	Group: View,
	Icon: StyledUIIcon,
	Root: ButtonRoot,
	Spinner: ActivityIndicator,
	Text,
});

const buttonStyle = tva({
	base: "group min-h-9 flex-row items-center justify-center gap-2 rounded-md px-4 py-2 transition-colors transition-transform duration-150 data-[active=true]:scale-[0.98] data-[disabled=true]:opacity-40 web:data-[focus-visible=true]:outline-none web:data-[focus-visible=true]:ring-2 web:data-[focus-visible=true]:ring-ring",
	variants: {
		size: {
			default: "min-h-9 px-4 py-2",
			icon: "h-9 w-9 p-0",
			lg: "min-h-10 px-6 py-2.5",
			sm: "min-h-8 px-3 py-1.5",
		},
		variant: {
			default: "bg-primary data-[active=true]:bg-primary/90 web:data-[hover=true]:bg-primary/90",
			destructive:
				"bg-destructive data-[active=true]:bg-destructive/90 web:data-[hover=true]:bg-destructive/90",
			ghost: "bg-transparent data-[active=true]:bg-accent web:data-[hover=true]:bg-accent",
			link: "bg-transparent data-[active=true]:opacity-70",
			outline:
				"border border-border bg-background data-[active=true]:bg-accent web:data-[hover=true]:bg-accent",
			secondary:
				"bg-secondary data-[active=true]:bg-secondary/80 web:data-[hover=true]:bg-secondary/80",
		},
	},
});

const buttonTextStyle = tva({
	base: "text-sm transition-opacity duration-150 group-active:opacity-80 group-focus:opacity-90 web:select-none",
	parentVariants: {
		size: {
			default: "text-sm",
			icon: "text-sm",
			lg: "text-base",
			sm: "text-xs",
		},
		variant: {
			default: "text-primary-foreground",
			destructive: "text-white",
			ghost: "text-foreground",
			link: "text-primary underline",
			outline: "text-foreground",
			secondary: "text-secondary-foreground",
		},
	},
});

const buttonSpinnerStyle = tva({
	base: "shrink-0",
	parentVariants: {
		size: {
			default: "h-4 w-4",
			icon: "h-4 w-4",
			lg: "h-5 w-5",
			sm: "h-3 w-3",
		},
	},
});

const buttonIconStyle = tva({
	base: "pointer-events-none shrink-0 fill-none transition-opacity duration-150 group-active:opacity-80 group-focus:opacity-90",
	parentVariants: {
		size: {
			default: "h-4 w-4",
			icon: "h-4 w-4",
			lg: "h-5 w-5",
			sm: "h-3 w-3",
		},
		variant: {
			default: "text-primary-foreground",
			destructive: "text-white",
			ghost: "text-foreground",
			link: "text-primary",
			outline: "text-foreground",
			secondary: "text-secondary-foreground",
		},
	},
});

const buttonGroupStyle = tva({
	variants: {
		flexDirection: {
			column: "flex-col",
			"column-reverse": "flex-col-reverse",
			row: "flex-row",
			"row-reverse": "flex-row-reverse",
		},
		isAttached: {
			true: "gap-0",
		},
		space: {
			"2xl": "gap-6",
			"3xl": "gap-7",
			"4xl": "gap-8",
			lg: "gap-4",
			md: "gap-3",
			sm: "gap-2",
			xl: "gap-5",
			xs: "gap-1",
		},
	},
});

type ButtonProps = Omit<React.ComponentPropsWithoutRef<typeof UIButton>, "context"> &
	VariantProps<typeof buttonStyle> & { className?: string };

const Button = React.forwardRef<React.ComponentRef<typeof UIButton>, ButtonProps>(function Button(
	{ className, size = "default", variant = "default", ...props },
	ref,
) {
	return (
		<UIButton
			className={buttonStyle({ class: className, size, variant })}
			context={{ size, variant }}
			ref={ref}
			{...props}
		/>
	);
});

type ButtonTextProps = React.ComponentPropsWithoutRef<typeof UIButton.Text> &
	VariantProps<typeof buttonTextStyle> & { className?: string };

const ButtonText = React.forwardRef<React.ComponentRef<typeof UIButton.Text>, ButtonTextProps>(
	function ButtonText({ className, size, ...props }, ref) {
		const { size: parentSize, variant: parentVariant } = useStyleContext(BUTTON_SCOPE);
		return (
			<UIButton.Text
				className={buttonTextStyle({
					class: className,
					parentVariants: { size: parentSize, variant: parentVariant },
					size,
				})}
				ref={ref}
				{...props}
			/>
		);
	},
);

type ButtonSpinnerProps = React.ComponentPropsWithoutRef<typeof UIButton.Spinner>;

const ButtonSpinner = React.forwardRef<
	React.ComponentRef<typeof UIButton.Spinner>,
	ButtonSpinnerProps
>(function ButtonSpinner({ className, ...props }, ref) {
	const { size: parentSize } = useStyleContext(BUTTON_SCOPE);
	return (
		<UIButton.Spinner
			className={buttonSpinnerStyle({
				class: className,
				parentVariants: { size: parentSize },
			})}
			ref={ref}
			{...props}
		/>
	);
});

type ButtonIconProps = React.ComponentPropsWithoutRef<typeof UIButton.Icon> &
	VariantProps<typeof buttonIconStyle> & {
		as?: React.ElementType;
		className?: string;
		height?: number;
		width?: number;
	};

const ButtonIcon = React.forwardRef<React.ComponentRef<typeof UIButton.Icon>, ButtonIconProps>(
	function ButtonIcon({ className, size, ...props }, ref) {
		const { size: parentSize, variant: parentVariant } = useStyleContext(BUTTON_SCOPE);
		if (typeof size === "number") {
			return (
				<UIButton.Icon
					className={buttonIconStyle({ class: className })}
					ref={ref}
					size={size}
					{...props}
				/>
			);
		}
		if (size === undefined && (props.height !== undefined || props.width !== undefined)) {
			return (
				<UIButton.Icon className={buttonIconStyle({ class: className })} ref={ref} {...props} />
			);
		}
		return (
			<UIButton.Icon
				className={buttonIconStyle({
					class: className,
					parentVariants: { size: parentSize, variant: parentVariant },
					size,
				})}
				ref={ref}
				{...props}
			/>
		);
	},
);

type ButtonGroupProps = React.ComponentPropsWithoutRef<typeof UIButton.Group> &
	VariantProps<typeof buttonGroupStyle>;

const ButtonGroup = React.forwardRef<React.ComponentRef<typeof UIButton.Group>, ButtonGroupProps>(
	function ButtonGroup(
		{ className, flexDirection = "column", isAttached = false, space = "md", ...props },
		ref,
	) {
		return (
			<UIButton.Group
				className={buttonGroupStyle({
					class: className,
					flexDirection,
					isAttached,
					space,
				})}
				ref={ref}
				{...props}
			/>
		);
	},
);

Button.displayName = "Button";
ButtonGroup.displayName = "ButtonGroup";
ButtonIcon.displayName = "ButtonIcon";
ButtonSpinner.displayName = "ButtonSpinner";
ButtonText.displayName = "ButtonText";

export { Button, ButtonGroup, ButtonIcon, ButtonSpinner, ButtonText };
