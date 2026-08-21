import type { ResolvedVoiceCommand } from "../../../shared/contracts.ts";
import {
	VOICE_ACTION_DEFINITIONS,
	VOICE_COMMAND_AUTO_EXECUTE_CONFIDENCE,
} from "../../../shared/voiceCommands.ts";

export type VoiceCommandDisposition = "execute" | "confirm" | "no-match";

export function voiceCommandDisposition(
	commands: ResolvedVoiceCommand[],
	confidence: number,
): VoiceCommandDisposition {
	if (commands.length === 0) return "no-match";
	if (commands.length > 1) return "confirm";
	const command = commands[0];
	if (!command) return "no-match";
	if (confidence < VOICE_COMMAND_AUTO_EXECUTE_CONFIDENCE) return "confirm";
	if (VOICE_ACTION_DEFINITIONS[command.actionId].risk === "dangerous") return "confirm";
	return "execute";
}
