import type { ApiErrorDiagnostic } from "../../shared/contracts.ts";
import { ApiError } from "../api.ts";

export interface FailureState {
	context: string;
	message: string;
	code: string;
	status: number | null;
	diagnostic?: ApiErrorDiagnostic;
}

export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : "Something went wrong.";
}

export function failureOf(error: unknown, context: string): FailureState {
	if (error instanceof ApiError) {
		return {
			context,
			message: error.message,
			code: error.code,
			status: error.status,
			diagnostic: error.diagnostic,
		};
	}
	return {
		context,
		message: messageOf(error),
		code: "client_error",
		status: null,
	};
}

export function formatFailureDiagnostics(failure: FailureState): string {
	const lines = [
		`Context: ${failure.context}`,
		`Message: ${failure.message}`,
		`Code: ${failure.code}`,
		`HTTP status: ${failure.status ?? "n/a"}`,
	];
	if (failure.diagnostic) {
		lines.push(
			`Diagnostic ID: ${failure.diagnostic.id}`,
			`Git operation: ${failure.diagnostic.operation}`,
			`Failure kind: ${failure.diagnostic.kind}`,
			`Exit code: ${failure.diagnostic.exitCode ?? "n/a"}`,
			`Retryable: ${failure.diagnostic.retryable ? "yes" : "no"}`,
			`Timeout: ${failure.diagnostic.timeoutMs ?? "n/a"} ms`,
		);
		if (failure.diagnostic.stderr) {
			lines.push("", "Git output:", failure.diagnostic.stderr);
		}
	}
	return lines.join("\n");
}
