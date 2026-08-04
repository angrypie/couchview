import { Sparkles } from "lucide-react";

import { CODEX_MODEL_SUGGESTIONS, CODEX_REASONING_LEVELS } from "../../shared/codexGeneration.ts";
import type { ProfileSettingsEditor } from "../features/settings/useProfileSettingsEditor.ts";

export function CodexGenerationSettingsCard({ editor }: { editor: ProfileSettingsEditor }) {
	return (
		<section className="settings-card" aria-labelledby="codex-generation-settings-title">
			<header className="settings-card-header">
				<div className="settings-card-heading">
					<span className="settings-card-icon">
						<Sparkles size={18} />
					</span>
					<div>
						<h2 id="codex-generation-settings-title">Codex generation</h2>
						<p>Shared by commit messages and artifact suggestions.</p>
					</div>
				</div>
			</header>
			<div className="codex-generation-fields">
				<label>
					<span>Model</span>
					<input
						aria-label="Model"
						autoCapitalize="none"
						autoCorrect="off"
						list="codex-generation-models"
						maxLength={128}
						onChange={(event) =>
							editor.updateDraft((next) => {
								next.codex.model = event.target.value;
								return next;
							})
						}
						value={editor.draft.codex.model}
					/>
					<datalist id="codex-generation-models">
						{CODEX_MODEL_SUGGESTIONS.map((model) => (
							<option key={model} value={model} />
						))}
					</datalist>
					<small>Type another Codex model ID if it is available on this host.</small>
				</label>
				<label>
					<span>Reasoning effort</span>
					<select
						aria-label="Reasoning effort"
						onChange={(event) =>
							editor.updateDraft((next) => {
								next.codex.reasoning = event.target.value as typeof next.codex.reasoning;
								return next;
							})
						}
						value={editor.draft.codex.reasoning}
					>
						{CODEX_REASONING_LEVELS.map((level) => (
							<option key={level} value={level}>
								{level}
							</option>
						))}
					</select>
					<small>Higher levels can improve inference but take longer.</small>
				</label>
			</div>
		</section>
	);
}
