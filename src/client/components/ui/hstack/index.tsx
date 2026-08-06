import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { View, type ViewProps } from "react-native";

const hstackStyle = tva({
	base: "flex-row",
	variants: {
		reversed: {
			true: "flex-row-reverse",
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

type HStackProps = ViewProps & VariantProps<typeof hstackStyle>;

const HStack = React.forwardRef<React.ComponentRef<typeof View>, HStackProps>(function HStack(
	{ className, reversed, space, ...props },
	ref,
) {
	return (
		<View
			className={hstackStyle({ class: className, reversed: reversed as boolean, space })}
			ref={ref}
			{...props}
		/>
	);
});

HStack.displayName = "HStack";

export { HStack };
