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
			"2xl": "text-2xl",
			"3xl": "text-3xl",
			lg: "text-lg",
			md: "text-base",
			sm: "text-sm",
			xl: "text-xl",
			xs: "text-xs",
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
				underline: underline as boolean,
			})}
			ref={ref}
			{...props}
		/>
	);
});

Text.displayName = "Text";

export { Text };
