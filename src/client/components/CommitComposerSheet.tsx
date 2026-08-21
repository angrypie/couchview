import { GitCommitHorizontal, Sparkles } from "lucide-react-native";

import type { CommitMessageCapability } from "../../shared/contracts.ts";
import { SpeechTextArea } from "./speech";
import { Button, Sheet, Text } from "./ui";

interface CommitComposerSheetProps {
	busy: boolean;
	capability: CommitMessageCapability;
	message: string;
	messageBusy: boolean;
	onClose: () => void;
	onGenerate: () => void;
	onMessageChange: (message: string) => void;
	onSubmit: () => void;
	open: boolean;
	stagedCount: number;
}

export function CommitComposerSheet({
	busy,
	capability,
	message,
	messageBusy,
	onClose,
	onGenerate,
	onMessageChange,
	onSubmit,
	open,
	stagedCount,
}: CommitComposerSheetProps) {
	return (
		<Sheet
			description={`${stagedCount} staged ${stagedCount === 1 ? "file" : "files"} · unstaged edits stay local`}
			footer={
				<>
					<Button
						disabled={!capability.available || messageBusy || busy || stagedCount === 0}
						leftIcon={Sparkles}
						loading={messageBusy}
						onPress={onGenerate}
						variant="secondary"
					>
						{messageBusy
							? "Generating…"
							: message.trim()
								? "Regenerate with Codex"
								: "Generate with Codex"}
					</Button>
					<Button
						disabled={!message.trim() || busy || messageBusy}
						leftIcon={GitCommitHorizontal}
						loading={busy}
						onPress={onSubmit}
					>
						Commit staged changes
					</Button>
				</>
			}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
			open={open}
			presentation="full"
			title="Commit staged changes"
		>
			<SpeechTextArea
				autoFocus
				containerClassName="min-h-32 flex-1 items-start py-1"
				editable={!messageBusy}
				maxLength={20_000}
				onChangeText={onMessageChange}
				placeholder="Commit message…"
				value={message}
			/>
			<Text className="text-muted-foreground" size="xs">
				{capability.available
					? messageBusy
						? "Generating a one-line Conventional Commit from staged changes…"
						: "Only staged changes are sent to Codex. Committing remains a separate action."
					: capability.reason}
			</Text>
		</Sheet>
	);
}
