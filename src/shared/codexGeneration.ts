export const CODEX_MODEL_SUGGESTIONS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const;
export const CODEX_REASONING_LEVELS = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
] as const;

export type CodexReasoningLevel = (typeof CODEX_REASONING_LEVELS)[number];

export interface CodexGenerationPreferences {
	model: string;
	reasoning: CodexReasoningLevel;
}

export const DEFAULT_CODEX_GENERATION_PREFERENCES: CodexGenerationPreferences = {
	model: "gpt-5.6-luna",
	reasoning: "low",
};

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export function parseCodexGenerationPreferences(value: unknown): CodexGenerationPreferences {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Codex generation preferences must be an object");
	}
	const candidate = value as Partial<CodexGenerationPreferences>;
	if (typeof candidate.model !== "string" || !MODEL_PATTERN.test(candidate.model)) {
		throw new Error("Codex model is invalid");
	}
	if (
		typeof candidate.reasoning !== "string" ||
		!(CODEX_REASONING_LEVELS as readonly string[]).includes(candidate.reasoning)
	) {
		throw new Error("Codex reasoning level is invalid");
	}
	return {
		model: candidate.model,
		reasoning: candidate.reasoning as CodexReasoningLevel,
	};
}
