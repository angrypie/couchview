import { Button, Host, Row } from "@expo/ui";
import type { ReactNode } from "react";

export function NativeControlHost({ children }: { children: ReactNode }) {
	return (
		<Host colorScheme="dark" matchContents seedColor="#7da6ff">
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
