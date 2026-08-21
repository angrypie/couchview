import {
	API_ROUTES,
	type TerminalAttachmentRequest,
	type TerminalLeaseRequest,
} from "../../../shared/contracts.ts";
import { ApiError, absoluteApiWebSocketUrl, api } from "../../api.ts";
import type {
	TerminalDomHostActions,
	TerminalDomResult,
} from "../../features/terminal/terminalDomContract.ts";
import { confirmAction } from "../../lib/confirmAction";

async function resultOf<Value>(request: Promise<Value>): Promise<TerminalDomResult<Value>> {
	try {
		return { ok: true, value: await request };
	} catch (error) {
		return {
			error: {
				code: error instanceof ApiError ? error.code : "request_failed",
				message: error instanceof Error ? error.message : "The terminal request failed.",
				status: error instanceof ApiError ? error.status : 0,
			},
			ok: false,
		};
	}
}

export function createTerminalHostActions(
	repositoryId: string,
	csrfToken: string,
): TerminalDomHostActions {
	return {
		confirm: confirmAction,
		createAttachment: (request: TerminalAttachmentRequest) =>
			resultOf(api.createTerminalAttachment(repositoryId, request, csrfToken)),
		endTerminal: () => resultOf(api.endTerminal(repositoryId, csrfToken)),
		renewLease: (request: TerminalLeaseRequest) =>
			resultOf(api.renewTerminalLease(repositoryId, request, csrfToken)),
		terminalWebSocketUrl: absoluteApiWebSocketUrl(API_ROUTES.terminalSocket(repositoryId)),
	};
}
