"use client";

import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { View } from "react-native";

import { Text } from "../text";

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

type CardSectionProps = React.ComponentPropsWithoutRef<typeof View>;

const cardHeaderStyle = tva({ base: "gap-1" });
const cardContentStyle = tva({ base: "gap-3" });
const cardFooterStyle = tva({ base: "flex-row items-center gap-2" });
const cardTitleStyle = tva({ base: "text-lg" });
const cardDescriptionStyle = tva({ base: "text-sm text-muted-foreground" });

function CardHeader({ className, ...props }: CardSectionProps) {
	return <View className={cardHeaderStyle({ class: className })} {...props} />;
}

function CardContent({ className, ...props }: CardSectionProps) {
	return <View className={cardContentStyle({ class: className })} {...props} />;
}

function CardFooter({ className, ...props }: CardSectionProps) {
	return <View className={cardFooterStyle({ class: className })} {...props} />;
}

type CardTitleProps = React.ComponentPropsWithoutRef<typeof Text>;

function CardTitle({ className, ...props }: CardTitleProps) {
	return <Text bold className={cardTitleStyle({ class: className })} {...props} />;
}

function CardDescription({ className, ...props }: CardTitleProps) {
	return <Text className={cardDescriptionStyle({ class: className })} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, type CardProps, CardTitle };
