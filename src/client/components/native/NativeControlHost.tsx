import { Button, Host, Row } from "@expo/ui";
import type { ReactNode } from "react";
import { useResolveClassNames } from "uniwind";

import { useNativePreferences } from "../../features/nativePreferences/NativePreferencesProvider.tsx";

export function NativeControlHost({ children }: { children: ReactNode }) {
	const { resolvedTheme } = useNativePreferences();
	const { color: seedColor } = useResolveClassNames("text-primary");

	return (
		<Host colorScheme={resolvedTheme} matchContents seedColor={seedColor}>
			<Row spacing={8}>{children}</Row>
		</Host>
	);
}

export function NativeHostedButton(props: {
	label: string;
	onPress(): void;
	disabled?: boolean;
	variant?: "filled" | "outlined" | "text";
}) {
	return (
		<NativeControlHost>
			<Button
				disabled={props.disabled}
				label={props.label}
				onPress={props.onPress}
				variant={props.variant}
			/>
		</NativeControlHost>
	);
}
