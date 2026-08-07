import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { View, type ViewProps } from "react-native";

const vstackStyle = tva({
	base: "flex-col",
	variants: {
		align: {
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
			true: "flex-col-reverse",
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

type VStackProps = ViewProps & VariantProps<typeof vstackStyle>;

const VStack = React.forwardRef<React.ComponentRef<typeof View>, VStackProps>(function VStack(
	{ align, className, justify, reversed, space, ...props },
	ref,
) {
	return (
		<View
			className={vstackStyle({
				align,
				class: className,
				justify,
				reversed: reversed as boolean,
				space,
			})}
			ref={ref}
			{...props}
		/>
	);
});

VStack.displayName = "VStack";

export { VStack, type VStackProps };
