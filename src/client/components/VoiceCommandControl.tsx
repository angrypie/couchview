import {
	CheckCircle2,
	CircleAlert,
	LoaderCircle,
	Mic,
	RotateCcw,
	Square,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { VOICE_ACTION_DEFINITIONS, type VoiceCommandRisk } from "../../shared/voiceCommands.ts";
import type { VoiceCommandController } from "../features/voiceCommands/index.ts";
import { Badge, Button, Dialog, HStack, Icon, Sheet, Text, VStack } from "./ui";

function RecordingCountdown({ endsAt }: { endsAt: number | null }) {
	const [remaining, setRemaining] = useState<number | null>(null);
	useEffect(() => {
		if (endsAt === null) {
			setRemaining(null);
			return;
		}
		const update = () => setRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1_000)));
		update();
		const timer = setInterval(update, 250);
		return () => clearInterval(timer);
	}, [endsAt]);
	if (remaining === null || remaining > 5) return null;
	return (
		<View className="absolute -left-1 -top-1 min-w-6 items-center rounded-full bg-destructive px-1 py-0.5">
			<Text className="text-destructive-foreground" size="xs">
				{remaining}
			</Text>
		</View>
	);
}

function VoiceResult({ controller }: { controller: VoiceCommandController }) {
	const result = controller.result;
	if (!result) return null;
	const success = result.status === "success";
	return (
		<View
			accessibilityLiveRegion="polite"
			className="absolute bottom-safe-offset-36 right-4 z-50 max-w-sm rounded-xl border border-border bg-popover p-3 shadow-xl"
			role="alert"
		>
			<HStack align="center" space="sm">
				<Icon
					as={success ? CheckCircle2 : CircleAlert}
					size={20}
					tone={success ? "success" : "destructive"}
				/>
				<Text className="min-w-0 flex-1" size="sm">
					{result.message}
				</Text>
				{result.undoAvailable ? (
					<Button
						leftIcon={RotateCcw}
						onPress={() => void controller.undo()}
						size="sm"
						variant="outline"
					>
						Undo
					</Button>
				) : null}
			</HStack>
		</View>
	);
}

function confidenceLabel(confidence: number): string {
	const percentage = (confidence * 100)
		.toFixed(2)
		.replace(/\.00$/, "")
		.replace(/(\.\d)0$/, "$1");
	return `Confidence: ${percentage}%`;
}

function NeedleReasoning({ reasoning }: { reasoning: string | null }) {
	const [open, setOpen] = useState(false);
	return (
		<VStack align="start" space="xs">
			<Button
				accessibilityState={{ expanded: open }}
				onPress={() => setOpen((current) => !current)}
				size="sm"
				variant="ghost"
			>
				{open ? "Hide Needle reasoning" : "Show Needle reasoning"}
			</Button>
			{open ? (
				<Text className="rounded-lg bg-muted p-3" selectable size="sm" tone="muted">
					{reasoning ?? "Needle did not provide reasoning for this interpretation."}
				</Text>
			) : null}
		</VStack>
	);
}

export function voiceConfirmationNotice(lowConfidence: boolean, risks: VoiceCommandRisk[]): string {
	if (lowConfidence) return "Low confidence — check every action before continuing.";
	if (risks.includes("dangerous")) {
		return "This command is classified as dangerous and requires confirmation.";
	}
	return "Multiple spoken commands always require confirmation in this version.";
}

function VoiceConfirmationSheet({ controller }: { controller: VoiceCommandController }) {
	const confirmation = controller.confirmation;
	const risks =
		confirmation?.commands.map((command) => VOICE_ACTION_DEFINITIONS[command.actionId].risk) ?? [];
	const notice = confirmation ? voiceConfirmationNotice(confirmation.lowConfidence, risks) : "";
	return (
		<Sheet
			dismissible
			footer={
				<>
					<Button onPress={controller.dismissConfirmation} variant="outline">
						Cancel
					</Button>
					<Button onPress={controller.confirm}>Run commands</Button>
				</>
			}
			onOpenChange={(open) => {
				if (!open) controller.dismissConfirmation();
			}}
			open={Boolean(confirmation)}
			title="Confirm voice commands"
		>
			{confirmation?.lowConfidence ? (
				<View className="rounded-lg border border-destructive bg-destructive/10 p-3">
					<HStack align="center" space="sm">
						<Icon as={CircleAlert} size={20} tone="destructive" />
						<Text className="min-w-0 flex-1 text-destructive" bold>
							{notice}
						</Text>
					</HStack>
				</View>
			) : (
				<Text tone="muted">{notice}</Text>
			)}
			<HStack align="center" justify="between" space="sm">
				<Text className="min-w-0 flex-1" size="sm" tone="muted">
					Transcript: “{confirmation?.transcript ?? ""}”
				</Text>
				{confirmation ? (
					<Badge variant={confirmation.lowConfidence ? "destructive" : "outline"}>
						{confidenceLabel(confirmation.confidence)}
					</Badge>
				) : null}
			</HStack>
			<VStack className="overflow-hidden rounded-xl border border-border">
				{confirmation?.commands.map((command, index) => {
					const definition = VOICE_ACTION_DEFINITIONS[command.actionId];
					return (
						<HStack
							align="center"
							className={index === 0 ? "p-3" : "border-t border-border p-3"}
							justify="between"
							key={`${command.actionId}-${index}`}
							space="sm"
						>
							<Text className="min-w-0 flex-1">{definition.title}</Text>
							<Badge variant={definition.risk === "dangerous" ? "destructive" : "outline"}>
								{definition.risk}
							</Badge>
						</HStack>
					);
				})}
			</VStack>
			{confirmation ? <NeedleReasoning reasoning={confirmation.reasoning} /> : null}
		</Sheet>
	);
}

function VoiceDiagnosticsDialog({ controller }: { controller: VoiceCommandController }) {
	const capability = controller.capability;
	return (
		<Dialog
			footer={
				<>
					{capability.canRetry ? (
						<Button onPress={() => void controller.retry()}>Retry installation</Button>
					) : null}
					<Button onPress={controller.dismissDiagnostics} variant="outline">
						Close
					</Button>
				</>
			}
			onOpenChange={(open) => {
				if (!open) controller.dismissDiagnostics();
			}}
			open={controller.diagnosticsOpen}
			title="Voice commands unavailable"
		>
			<Text>{capability.reason ?? "Host speech or Needle 2 is not ready."}</Text>
			<VStack className="rounded-lg bg-muted p-3" space="xs">
				<Text bold>Required server flags</Text>
				{capability.requiredFlags.map((flag) => (
					<Text key={flag} selectable>
						{flag}
					</Text>
				))}
			</VStack>
			<Text size="sm" tone="muted">
				Restart Couchview with both flags. Needle runs only on the host; no cloud fallback is used.
			</Text>
		</Dialog>
	);
}

export function VoiceCommandControl({ controller }: { controller: VoiceCommandController }) {
	if (!controller.enabled) return null;
	const unavailable = !controller.available;
	const active = controller.phase !== "idle";
	const processing =
		controller.phase === "requestingPermission" ||
		controller.phase === "transcribing" ||
		controller.phase === "resolving";
	const label = unavailable
		? "Voice commands unavailable; show details"
		: controller.phase === "recording"
			? "Stop voice command recording"
			: processing
				? "Cancel voice command"
				: "Start voice command";
	return (
		<>
			<VoiceResult controller={controller} />
			<View className="absolute bottom-safe-offset-20 right-4 z-50">
				<Pressable
					accessibilityLabel={label}
					accessibilityRole="button"
					accessibilityState={{
						busy: processing,
						disabled: controller.blockedByDictation,
					}}
					className={
						unavailable
							? "size-14 items-center justify-center rounded-full border border-warning bg-popover shadow-xl disabled:opacity-50"
							: active
								? "size-14 items-center justify-center rounded-full bg-destructive shadow-xl disabled:opacity-50"
								: "size-14 items-center justify-center rounded-full bg-primary shadow-xl disabled:opacity-50"
					}
					disabled={controller.blockedByDictation}
					onPress={controller.toggle}
					testID="voice-command-button"
				>
					<Icon
						as={
							unavailable
								? CircleAlert
								: processing
									? LoaderCircle
									: controller.phase === "recording"
										? Square
										: Mic
						}
						size={24}
						tone={
							unavailable ? "warning" : active ? "destructive-foreground" : "primary-foreground"
						}
					/>
					<RecordingCountdown endsAt={controller.recordingEndsAt} />
					{unavailable ? (
						<View className="absolute -right-1 -top-1 size-5 items-center justify-center rounded-full bg-warning">
							<Icon as={CircleAlert} size={13} tone="warning-foreground" />
						</View>
					) : null}
				</Pressable>
			</View>
			<VoiceConfirmationSheet controller={controller} />
			<VoiceDiagnosticsDialog controller={controller} />
		</>
	);
}
