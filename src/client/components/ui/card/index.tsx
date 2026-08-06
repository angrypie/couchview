"use client";

import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { View } from "react-native";

const cardStyle = tva({
	base: "flex-col rounded-xl border border-border bg-card shadow-sm",
	defaultVariants: {
		size: "default",
	},
	variants: {
		size: {
			default: "gap-6 p-4",
			sm: "gap-3 p-3",
		},
	},
});

type CardProps = React.ComponentPropsWithoutRef<typeof View> &
	VariantProps<typeof cardStyle> & { className?: string };

const Card = React.forwardRef<React.ComponentRef<typeof View>, CardProps>(function Card(
	{ className, size = "default", ...props },
	ref,
) {
	return <View className={cardStyle({ class: className, size })} ref={ref} {...props} />;
});

Card.displayName = "Card";

export { Card };
