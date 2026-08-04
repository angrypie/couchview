import { useCallback, useEffect, useRef, useState } from "react";

import type {
	ArtifactProposalResponse,
	BootstrapResponse,
	CodexCapability,
	CodexGenerationPreferences,
} from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { messageOf } from "../../lib/failures.ts";

interface UseArtifactProposalOptions {
	active: boolean;
	bootstrap: BootstrapResponse | null;
	codexPreferences: CodexGenerationPreferences;
	proposalCapability: CodexCapability;
	repositoryId: string | null;
	showToast(message: string): void;
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

export function useArtifactProposal({
	active,
	bootstrap,
	codexPreferences,
	proposalCapability,
	repositoryId,
	showToast,
}: UseArtifactProposalOptions) {
	const [busy, setBusy] = useState(false);
	const requestRef = useRef<AbortController | null>(null);
	const repositoryIdRef = useRef(repositoryId);
	repositoryIdRef.current = repositoryId;

	useEffect(() => {
		requestRef.current?.abort();
		requestRef.current = null;
		setBusy(false);
		return () => {
			requestRef.current?.abort();
			requestRef.current = null;
		};
	}, [active, repositoryId]);

	const propose = useCallback(
		async (request: string): Promise<ArtifactProposalResponse | null> => {
			if (!active || !bootstrap || !repositoryId || !proposalCapability.available || busy) {
				return null;
			}
			const activeRepositoryId = repositoryId;
			const controller = new AbortController();
			requestRef.current?.abort();
			requestRef.current = controller;
			setBusy(true);
			try {
				const response = await api.proposeArtifact(
					activeRepositoryId,
					{ request, codex: codexPreferences },
					bootstrap.csrfToken,
					controller.signal,
				);
				if (
					controller.signal.aborted ||
					requestRef.current !== controller ||
					repositoryIdRef.current !== activeRepositoryId
				) {
					return null;
				}
				return response;
			} catch (error) {
				if (!controller.signal.aborted && !isAbortError(error)) showToast(messageOf(error));
				return null;
			} finally {
				if (requestRef.current === controller) {
					requestRef.current = null;
					setBusy(false);
				}
			}
		},
		[
			active,
			bootstrap,
			busy,
			codexPreferences,
			proposalCapability.available,
			repositoryId,
			showToast,
		],
	);

	return { busy, capability: proposalCapability, propose };
}
