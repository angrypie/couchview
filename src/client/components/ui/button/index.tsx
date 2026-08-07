import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React, { type ReactNode } from "react";
import { ActivityIndicator, Pressable, type PressableProps } from "react-native";

import { Icon, type IconTone, type LucideIcon } from "../icon";
import { Text } from "../text";

const buttonStyle = tva({
	base: "flex-row items-center justify-center gap-2 rounded-lg active:opacity-80 web:cursor-pointer web:transition-colors disabled:web:cursor-not-allowed",
	defaultVariants: { size: "md", variant: "primary" },
	variants: {
		disabled: { true: "opacity-50" },
		fullWidth: { true: "w-full" },
		size: {
			lg: "min-h-12 px-5",
			md: "min-h-10 px-4",
			sm: "min-h-8 px-3",
		},
		variant: {
			destructive: "bg-destructive",
			ghost: "bg-transparent hover:bg-muted",
			outline: "border border-border bg-background hover:bg-muted",
			primary: "bg-primary",
			secondary: "bg-secondary hover:bg-muted",
		},
	},
});

const buttonTextStyle = tva({
	base: "font-semibold",
	defaultVariants: { size: "md", variant: "primary" },
	variants: {
		size: { lg: "text-base", md: "text-sm", sm: "text-xs" },
		variant: {
			destructive: "text-destructive-foreground",
			ghost: "text-foreground",
			outline: "text-foreground",
			primary: "text-primary-foreground",
			secondary: "text-secondary-foreground",
		},
	},
});

const iconToneByVariant = {
	destructive: "destructive-foreground",
	ghost: "foreground",
	outline: "foreground",
	primary: "primary-foreground",
	secondary: "secondary-foreground",
} as const satisfies Record<string, IconTone>;

const loadingColorByVariant = {
	destructive: "accent-destructive-foreground",
	ghost: "accent-foreground",
	outline: "accent-foreground",
	primary: "accent-primary-foreground",
	secondary: "accent-secondary-foreground",
} as const;

type ButtonProps = Omit<PressableProps, "children"> &
	VariantProps<typeof buttonStyle> & {
		children: ReactNode;
		leftIcon?: LucideIcon;
		loading?: boolean;
		rightIcon?: LucideIcon;
	};

const Button = React.forwardRef<React.ComponentRef<typeof Pressable>, ButtonProps>(function Button(
	{
		accessibilityState,
		children,
		className,
		disabled,
		fullWidth,
		leftIcon,
		loading = false,
		rightIcon,
		size = "md",
		variant = "primary",
		...props
	},
	ref,
) {
	const isDisabled = disabled || loading;
	const iconSize = size === "lg" ? 20 : 18;
	const iconTone = iconToneByVariant[variant ?? "primary"];

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ ...accessibilityState, busy: loading, disabled: isDisabled }}
			className={buttonStyle({
				class: className,
				disabled: isDisabled,
				fullWidth: fullWidth as boolean,
				size,
				variant,
			})}
			disabled={isDisabled}
			ref={ref}
			{...props}
		>
			{loading ? (
				<ActivityIndicator
					colorClassName={loadingColorByVariant[variant ?? "primary"]}
					size="small"
				/>
			) : leftIcon ? (
				<Icon as={leftIcon} size={iconSize} tone={iconTone} />
			) : null}
			<Text className={buttonTextStyle({ size, variant })}>{children}</Text>
			{rightIcon ? <Icon as={rightIcon} size={iconSize} tone={iconTone} /> : null}
		</Pressable>
	);
});

Button.displayName = "Button";

const iconButtonStyle = tva({
	base: "items-center justify-center rounded-lg active:opacity-80 web:cursor-pointer disabled:opacity-50 disabled:web:cursor-not-allowed",
	defaultVariants: { size: "md", variant: "ghost" },
	variants: {
		size: { lg: "size-12", md: "size-10", sm: "size-8" },
		variant: {
			destructive: "bg-destructive",
			ghost: "bg-transparent hover:bg-muted",
			outline: "border border-border bg-background hover:bg-muted",
			primary: "bg-primary",
			secondary: "bg-secondary hover:bg-muted",
		},
	},
});

type IconButtonProps = Omit<PressableProps, "children"> &
	VariantProps<typeof iconButtonStyle> & {
		accessibilityLabel: string;
		icon: LucideIcon;
	};

const IconButton = React.forwardRef<React.ComponentRef<typeof Pressable>, IconButtonProps>(
	function IconButton(
		{ accessibilityLabel, className, icon, size = "md", variant = "ghost", ...props },
		ref,
	) {
		return (
			<Pressable
				accessibilityLabel={accessibilityLabel}
				accessibilityRole="button"
				className={iconButtonStyle({ class: className, size, variant })}
				ref={ref}
				{...props}
			>
				<Icon
					as={icon}
					size={size === "lg" ? 22 : size === "sm" ? 16 : 20}
					tone={iconToneByVariant[variant ?? "ghost"]}
				/>
			</Pressable>
		);
	},
);

IconButton.displayName = "IconButton";

export { Button, type ButtonProps, IconButton, type IconButtonProps };
