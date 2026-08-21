import { Copy } from "lucide-react-native";
import { ScrollView, View } from "react-native";

import type { FailureState } from "../lib/failures.ts";
import { Button, Card, Heading, Sheet, Text } from "./ui";

interface FailureDetailsSheetProps {
	failure: FailureState | null;
	onClose: () => void;
	onCopy: () => void;
	open: boolean;
}

function Detail({ label, value }: { label: string; value: string | number }) {
	return (
		<View className="min-w-32 flex-1 gap-1">
			<Text className="text-muted-foreground" size="xs">
				{label}
			</Text>
			<Text selectable size="sm">
				{value}
			</Text>
		</View>
	);
}

export function FailureDetailsSheet({ failure, onClose, onCopy, open }: FailureDetailsSheetProps) {
	return (
		<Sheet
			description={failure ? `${failure.context} · ${failure.code}` : undefined}
			footer={
				<>
					<Button onPress={onClose} variant="secondary">
						Close
					</Button>
					<Button leftIcon={Copy} onPress={onCopy}>
						Copy diagnostics
					</Button>
				</>
			}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
			open={open && Boolean(failure)}
			title="Error details"
		>
			{failure ? (
				<ScrollView className="max-h-[60vh]" contentContainerClassName="gap-4">
					<Text selectable>{failure.message}</Text>
					<View className="flex-row flex-wrap gap-3">
						<Detail label="HTTP status" value={failure.status ?? "Not available"} />
						<Detail label="Error code" value={failure.code} />
						{failure.diagnostic ? (
							<>
								<Detail label="Diagnostic ID" value={failure.diagnostic.id} />
								<Detail label="Git operation" value={failure.diagnostic.operation} />
								<Detail label="Failure kind" value={failure.diagnostic.kind} />
								<Detail label="Exit code" value={failure.diagnostic.exitCode ?? "Not available"} />
							</>
						) : null}
					</View>
					{failure.diagnostic ? (
						<View className="gap-2">
							<Heading level={4}>Git output</Heading>
							<Card className="bg-background">
								<Text className="font-mono" selectable size="xs">
									{failure.diagnostic.stderr || "Git returned no stderr output."}
								</Text>
							</Card>
						</View>
					) : null}
				</ScrollView>
			) : null}
		</Sheet>
	);
}
