import { randomUUID } from "node:crypto";

import type { ApiErrorBody, ApiErrorDiagnostic } from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import { GitCommandError } from "./git/index.ts";
import { json } from "./serverHttp.ts";

export function errorResponse(error: unknown): Response {
	if (error instanceof HttpError) {
		const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
		return json(body, { status: error.status });
	}
	if (error instanceof GitCommandError) {
		const diagnosticId = randomUUID().slice(0, 8);
		const detail = cleanDiagnosticText(error.stderr || error.message);
		const firstLine = detail.split("\n").find(Boolean)?.slice(0, 240) ?? "No details returned";
		const locked = /index\.lock|another git process/i.test(detail);
		let status = 500;
		let code = "git_failed";
		let message = `Git ${error.operation} failed`;
		let retryable = false;

		if (locked) {
			status = 423;
			code = "git_index_locked";
			message = "The Git index is busy; try again shortly";
			retryable = true;
		} else if (error.kind === "timeout") {
			status = 504;
			code = "git_timeout";
			message = `Git ${error.operation} stopped responding after ${Math.ceil(
				(error.timeoutMs ?? 0) / 1_000,
			)} seconds`;
			retryable = true;
		} else if (error.kind === "spawn") {
			status = 503;
			code = "git_unavailable";
			message = `Git ${error.operation} could not start: ${firstLine}`;
			retryable = true;
		} else if (error.kind === "capture") {
			status = 502;
			code = "git_output_capture";
			message = `Git ${error.operation} returned data that Couchview could not capture safely`;
			retryable = true;
		} else if (error.kind === "output_limit") {
			status = 502;
			code = "git_output_limit";
			message = `Git ${error.operation} returned more data than Couchview can safely process`;
		} else if (error.kind === "empty_output") {
			status = 503;
			code = "git_empty_output";
			message = "Git diff returned no data for a changed file after two attempts";
			retryable = true;
		} else {
			const exit = error.exitCode >= 0 ? ` (exit ${error.exitCode})` : "";
			message = `Git ${error.operation} failed${exit}: ${firstLine}`;
		}

		const diagnostic: ApiErrorDiagnostic = {
			id: diagnosticId,
			source: "git",
			operation: error.operation,
			kind: error.kind,
			exitCode: error.exitCode >= 0 ? error.exitCode : null,
			stderr: detail,
			retryable,
			timeoutMs: error.timeoutMs,
		};
		console.error(
			`[git:${diagnosticId}] operation=${error.operation} kind=${error.kind} ` +
				`exit=${error.exitCode} ${detail || "No stderr returned"}`,
		);
		const body: ApiErrorBody = {
			error: {
				code,
				message,
				diagnostic,
			},
		};
		return json(body, {
			status,
			headers: { "X-Couchview-Diagnostic": diagnosticId },
		});
	}
	console.error(error);
	const body: ApiErrorBody = {
		error: { code: "internal_error", message: "The local review server encountered an error" },
	};
	return json(body, { status: 500 });
}

function cleanDiagnosticText(value: string): string {
	return value
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replaceAll("\0", "�")
		.trim()
		.slice(0, 4_000);
}

export function addSecurityHeaders(response: Response): Response {
	const headers = response.headers;
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Frame-Options", "DENY");
	headers.set("Referrer-Policy", "no-referrer");
	headers.set("Cross-Origin-Resource-Policy", "same-origin");
	headers.set("Cross-Origin-Opener-Policy", "same-origin");
	headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	headers.set(
		"Content-Security-Policy",
		"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'none'",
	);
	return response;
}
