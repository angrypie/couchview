import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { View, type ViewProps } from "react-native";

const hstackStyle = tva({
	base: "flex-row",
	variants: {
		align: {
			baseline: "items-baseline",
			center: "items-center",
			end: "items-end",
			start: "items-start",
			stretch: "items-stretch",
		},
		justify: {
			around: "justify-around",
			between: "justify-between",
			center: "justify-center",
			end: "justify-end",
			evenly: "justify-evenly",
			start: "justify-start",
		},
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
		wrap: {
			true: "flex-wrap",
		},
	},
});

type HStackProps = ViewProps & VariantProps<typeof hstackStyle>;

const HStack = React.forwardRef<React.ComponentRef<typeof View>, HStackProps>(function HStack(
	{ align, className, justify, reversed, space, wrap, ...props },
	ref,
) {
	return (
		<View
			className={hstackStyle({
				align,
				class: className,
				justify,
				reversed: reversed as boolean,
				space,
				wrap: wrap as boolean,
			})}
			ref={ref}
			{...props}
		/>
	);
});

HStack.displayName = "HStack";

export { HStack, type HStackProps };
