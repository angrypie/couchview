import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, Heading, HStack, Text, VStack } from "../ui";

export function SettingsSection({
	action,
	children,
	description,
	testID,
	title,
}: {
	action?: ReactNode;
	children: ReactNode;
	description: ReactNode;
	testID?: string;
	title: ReactNode;
}) {
	return (
		<Card className="gap-4" testID={testID}>
			<CardHeader>
				<HStack align="start" className="gap-3" justify="between">
					<VStack className="min-w-0 flex-1" space="xs">
						<Heading level={2}>{title}</Heading>
						<Text size="sm" tone="muted">
							{description}
						</Text>
					</VStack>
					{action}
				</HStack>
			</CardHeader>
			<CardContent className="gap-5">{children}</CardContent>
		</Card>
	);
}

export function SettingsField({
	children,
	description,
	label,
	value,
}: {
	children: ReactNode;
	description?: ReactNode;
	label: ReactNode;
	value?: ReactNode;
}) {
	return (
		<VStack space="xs">
			<HStack align="center" justify="between" space="sm">
				<Text bold size="sm">
					{label}
				</Text>
				{value ? (
					<Text className="font-mono" size="sm" tone="muted">
						{value}
					</Text>
				) : null}
			</HStack>
			{children}
			{description ? (
				<Text size="xs" tone="muted">
					{description}
				</Text>
			) : null}
		</VStack>
	);
}
