import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { View, type ViewProps } from "react-native";

const vstackStyle = tva({
	base: "flex-col",
	variants: {
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
	{ className, reversed, space, ...props },
	ref,
) {
	return (
		<View
			className={vstackStyle({ class: className, reversed: reversed as boolean, space })}
			ref={ref}
			{...props}
		/>
	);
});

VStack.displayName = "VStack";

export { VStack };
