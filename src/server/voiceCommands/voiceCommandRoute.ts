import { API_ROUTES, type ResolveVoiceCommandsRequest } from "../../shared/contracts.ts";
import { json, readJsonObject } from "../serverHttp.ts";
import type { VoiceCommandService } from "./VoiceCommandService.ts";

export async function handleVoiceCommandApi(
	service: VoiceCommandService,
	request: Request,
	url: URL,
): Promise<Response | null> {
	if (url.pathname === API_ROUTES.voiceCommandResolve && request.method === "POST") {
		const input = await readJsonObject<ResolveVoiceCommandsRequest>(request);
		return json(await service.resolve(input.transcript));
	}
	if (url.pathname === API_ROUTES.voiceCommandRetry && request.method === "POST") {
		return json(await service.retry());
	}
	return null;
}
