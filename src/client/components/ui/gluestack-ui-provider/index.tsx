"use client";

import { OverlayProvider } from "@gluestack-ui/core/overlay/creator";
import { ToastProvider } from "@gluestack-ui/core/toast/creator";
import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

interface GluestackUIProviderProps {
	children?: ReactNode;
	style?: ViewProps["style"];
}

export function GluestackUIProvider({ children, style }: GluestackUIProviderProps) {
	return (
		<View style={[{ flex: 1, height: "100%", width: "100%" }, style]}>
			<OverlayProvider>
				<ToastProvider>{children}</ToastProvider>
			</OverlayProvider>
		</View>
	);
}
