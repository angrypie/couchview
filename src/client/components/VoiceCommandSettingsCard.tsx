import type { ProfileSettingsEditor } from "../features/settings/useProfileSettingsEditor.ts";
import type { VoiceCommandController } from "../features/voiceCommands/index.ts";
import { SettingsSection } from "./settings/SettingsSection.tsx";
import { Badge, Button, HStack, Switch, Text, VStack } from "./ui";

export function VoiceCommandSettingsCard({
	controller,
	editor,
}: {
	controller: VoiceCommandController;
	editor: ProfileSettingsEditor;
}) {
	const capability = controller.capability;
	return (
		<SettingsSection
			description="Use host speech transcription and local Needle 2 inference to control Couchview."
			title="Voice commands"
		>
			<Switch
				description={
					capability.enabled
						? "Show the voice-command action button for this profile."
						: "The server did not start with --enable-voice-commands, so profiles cannot enable it."
				}
				disabled={!capability.enabled}
				label="Voice command button"
				onValueChange={(commandsEnabled) =>
					editor.updateDraft((next) => {
						next.voice.commandsEnabled = commandsEnabled;
						return next;
					})
				}
				value={capability.enabled && editor.draft.voice.commandsEnabled}
			/>
			<HStack align="center" justify="between" space="sm">
				<VStack className="min-w-0 flex-1" space="xs">
					<Text bold>Host runtime</Text>
					<Text size="sm" tone="muted">
						{capability.reason ?? "Needle 2 is ready on this host."}
					</Text>
				</VStack>
				<Badge variant={capability.ready ? "success" : "outline"}>{capability.state}</Badge>
			</HStack>
			{capability.canRetry ? (
				<Button className="self-start" onPress={() => void controller.retry()} variant="outline">
					Retry Needle installation
				</Button>
			) : null}
			<Text size="xs" tone="muted">
				Required host flags: --enable-speech --enable-voice-commands
			</Text>
			<Text size="xs" tone="muted">
				Keyboard: hold V to talk, or press Shift+V to start or stop recording.
			</Text>
		</SettingsSection>
	);
}
