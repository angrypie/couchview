"use client";

import { OverlayProvider } from "@gluestack-ui/core/overlay/creator";
import { ToastProvider } from "@gluestack-ui/core/toast/creator";
import { tva } from "@gluestack-ui/utils/nativewind-utils";
import type { ReactNode } from "react";
import { View } from "react-native";

const providerStyle = tva({ base: "h-full w-full flex-1 bg-background" });

interface GluestackUIProviderProps {
	children?: ReactNode;
	className?: string;
}

export function GluestackUIProvider({ children, className }: GluestackUIProviderProps) {
	return (
		<View className={providerStyle({ class: className })}>
			<OverlayProvider>
				<ToastProvider>{children}</ToastProvider>
			</OverlayProvider>
		</View>
	);
}
