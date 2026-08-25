export type FetchResponseLike = Pick<
	Response,
	"body" | "headers" | "json" | "ok" | "status" | "type"
>;

export type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<FetchResponseLike>;
