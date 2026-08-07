import { CODEX_MODEL_SUGGESTIONS, CODEX_REASONING_LEVELS } from "../../shared/codexGeneration.ts";
import type { ProfileSettingsEditor } from "../features/settings/useProfileSettingsEditor.ts";
import { SettingsField, SettingsSection } from "./settings/SettingsSection.tsx";
import { Button, HStack, Input, InputField, Select } from "./ui";

const REASONING_OPTIONS = CODEX_REASONING_LEVELS.map((level) => ({
	label: level,
	value: level,
}));

export function CodexGenerationSettingsCard({ editor }: { editor: ProfileSettingsEditor }) {
	const selectModel = (model: string) => {
		editor.updateDraft((next) => {
			next.codex.model = model;
			return next;
		});
	};

	return (
		<SettingsSection
			description="Shared by commit messages and artifact suggestions."
			title="Codex generation"
		>
			<SettingsField description="Enter any Codex model ID available on this host." label="Model">
				<Input>
					<InputField
						accessibilityLabel="Model"
						autoCapitalize="none"
						autoCorrect={false}
						maxLength={128}
						onChangeText={selectModel}
						value={editor.draft.codex.model}
					/>
				</Input>
				<HStack className="flex-wrap" space="sm">
					{CODEX_MODEL_SUGGESTIONS.map((model) => (
						<Button
							key={model}
							onPress={() => selectModel(model)}
							size="sm"
							variant={editor.draft.codex.model === model ? "secondary" : "outline"}
						>
							{model}
						</Button>
					))}
				</HStack>
			</SettingsField>
			<SettingsField
				description="Higher levels can improve inference but take longer."
				label="Reasoning effort"
			>
				<Select
					accessibilityLabel="Reasoning effort"
					onValueChange={(reasoning) =>
						editor.updateDraft((next) => {
							next.codex.reasoning = reasoning as typeof next.codex.reasoning;
							return next;
						})
					}
					options={REASONING_OPTIONS}
					value={editor.draft.codex.reasoning}
				/>
			</SettingsField>
		</SettingsSection>
	);
}
