import type {
	TerminalAttachmentRequest,
	TerminalAttachmentResponse,
	TerminalEndResponse,
	TerminalLeaseRequest,
	TerminalLeaseResponse,
} from "../../../shared/contracts.ts";

export interface TerminalDomError {
	code: string;
	message: string;
	status: number;
}

export type TerminalDomResult<Value> =
	| { ok: true; value: Value }
	| { error: TerminalDomError; ok: false };

export interface TerminalDomHostActions {
	confirm(message: string): Promise<boolean>;
	createAttachment(
		request: TerminalAttachmentRequest,
	): Promise<TerminalDomResult<TerminalAttachmentResponse>>;
	endTerminal(): Promise<TerminalDomResult<TerminalEndResponse>>;
	renewLease(request: TerminalLeaseRequest): Promise<TerminalDomResult<TerminalLeaseResponse>>;
	terminalWebSocketUrl: string;
}

export class TerminalDomRequestError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(error: TerminalDomError) {
		super(error.message);
		this.name = "TerminalDomRequestError";
		this.code = error.code;
		this.status = error.status;
	}
}

export function unwrapTerminalDomResult<Value>(result: TerminalDomResult<Value>): Value {
	if (!result.ok) throw new TerminalDomRequestError(result.error);
	return result.value;
}
