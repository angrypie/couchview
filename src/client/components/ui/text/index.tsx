import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { Text as NativeText } from "react-native";

const textStyle = tva({
	base: "text-foreground",
	variants: {
		bold: {
			true: "font-bold",
		},
		highlight: {
			true: "bg-yellow-500",
		},
		isTruncated: {
			true: "web:truncate",
		},
		italic: {
			true: "italic",
		},
		size: {
			"4xl": "text-4xl",
			"2xl": "text-2xl",
			"3xl": "text-3xl",
			lg: "text-lg",
			md: "text-base",
			sm: "text-sm",
			xl: "text-xl",
			xs: "text-xs",
		},
		tone: {
			accent: "text-accent-foreground",
			destructive: "text-destructive",
			foreground: "text-foreground",
			muted: "text-muted-foreground",
			primary: "text-primary",
			success: "text-success",
			warning: "text-warning",
		},
		strikeThrough: {
			true: "line-through",
		},
		sub: {
			true: "text-xs",
		},
		underline: {
			true: "underline",
		},
	},
});

type TextProps = React.ComponentPropsWithoutRef<typeof NativeText> & VariantProps<typeof textStyle>;

const Text = React.forwardRef<React.ComponentRef<typeof NativeText>, TextProps>(function Text(
	{
		bold,
		className,
		highlight,
		isTruncated,
		italic,
		size = "md",
		strikeThrough,
		sub,
		tone,
		underline,
		...props
	},
	ref,
) {
	return (
		<NativeText
			className={textStyle({
				bold: bold as boolean,
				class: className,
				highlight: highlight as boolean,
				isTruncated: isTruncated as boolean,
				italic: italic as boolean,
				size,
				strikeThrough: strikeThrough as boolean,
				sub: sub as boolean,
				tone,
				underline: underline as boolean,
			})}
			ref={ref}
			{...props}
		/>
	);
});

Text.displayName = "Text";

const headingStyle = tva({
	base: "font-semibold tracking-tight text-foreground",
	variants: {
		level: {
			1: "text-4xl",
			2: "text-3xl",
			3: "text-2xl",
			4: "text-xl",
			5: "text-lg",
			6: "text-base",
		},
	},
});

type HeadingProps = Omit<React.ComponentPropsWithoutRef<typeof NativeText>, "role"> &
	VariantProps<typeof headingStyle>;

const Heading = React.forwardRef<React.ComponentRef<typeof NativeText>, HeadingProps>(
	function Heading({ className, level = 2, ...props }, ref) {
		return (
			<NativeText
				accessibilityRole="header"
				aria-level={level ?? undefined}
				className={headingStyle({ class: className, level })}
				ref={ref}
				{...props}
			/>
		);
	},
);

Heading.displayName = "Heading";

export { Heading, type HeadingProps, Text, type TextProps };
