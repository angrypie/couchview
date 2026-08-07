import { Square } from "lucide-react-native";
import type { RefObject } from "react";
import { ScrollView, View } from "react-native";

import type { PackageRunSnapshot, PackageRunSummary } from "../../shared/contracts.ts";
import { runElapsed, runStatusLabel } from "../features/packages/packageRuns.ts";
import { Badge, Button, Card, Sheet, Text } from "./ui";

interface PackageRunSheetProps {
	busyKey: string | null;
	clock: number;
	onClose: () => void;
	onStop: () => void;
	outputRef: RefObject<ScrollView | null>;
	repositoryRoot?: string;
	run: PackageRunSummary | null;
	snapshot: PackageRunSnapshot | null;
}

function statusVariant(status: PackageRunSummary["status"]) {
	if (status === "succeeded") return "success" as const;
	if (status === "failed") return "destructive" as const;
	if (status === "running" || status === "stopping") return "warning" as const;
	return "neutral" as const;
}

function ContextValue({ label, value }: { label: string; value: string }) {
	return (
		<View className="gap-1">
			<Text className="text-muted-foreground" size="xs">
				{label}
			</Text>
			<Text className="font-mono" selectable size="xs">
				{value}
			</Text>
		</View>
	);
}

export function PackageRunSheet({
	busyKey,
	clock,
	onClose,
	onStop,
	outputRef,
	repositoryRoot,
	run,
	snapshot,
}: PackageRunSheetProps) {
	const active = Boolean(run && ["running", "stopping"].includes(run.status));
	return (
		<Sheet
			description={
				run
					? `${runElapsed(run, clock)}${run.exitCode !== null ? ` · exit ${run.exitCode}` : ""}`
					: undefined
			}
			footer={
				<>
					<Button onPress={onClose} variant="secondary">
						Close
					</Button>
					{active && run ? (
						<Button
							disabled={run.status === "stopping" || busyKey === run.id}
							leftIcon={Square}
							loading={busyKey === run.id}
							onPress={onStop}
							variant="destructive"
						>
							{run.status === "stopping" ? "Stopping…" : "Stop"}
						</Button>
					) : null}
				</>
			}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
			open={Boolean(run)}
			title={run ? `${run.packageName ?? run.directory} / ${run.scriptName}` : "Package command"}
		>
			{run ? (
				<>
					<Badge variant={statusVariant(run.status)}>{runStatusLabel(run.status)}</Badge>
					<Card className="gap-3 bg-background" size="sm">
						<ContextValue
							label="Working directory"
							value={
								run.directory === "."
									? (repositoryRoot ?? ".")
									: `${repositoryRoot}/${run.directory}`
							}
						/>
						<ContextValue label="Invocation" value={run.invocation} />
						<ContextValue label="package.json script" value={run.command} />
					</Card>
					<ScrollView
						className="h-64 rounded-lg border border-border bg-background p-3"
						ref={outputRef}
					>
						<Text className="font-mono" selectable size="xs">
							{run.outputTruncated ? "[Earlier output was truncated.]\n" : ""}
							{snapshot?.output.length
								? snapshot.output.map((chunk) => chunk.text).join("")
								: active
									? "Waiting for output…"
									: "The command produced no output."}
						</Text>
					</ScrollView>
				</>
			) : null}
		</Sheet>
	);
}
