import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { absoluteApiDownloadUrl, apiRequestHeaders } from "../api.ts";
import type { ArtifactDownloadRequest } from "./artifactDownloadTypes.ts";

function safeDownloadName(value: string): string {
	const sanitized = value.replaceAll(/[\\/:*?"<>|]/g, "-").trim();
	return sanitized || "couchview-artifact";
}

function requestHeaders(): Record<string, string> {
	return Object.fromEntries(apiRequestHeaders().entries());
}

export async function downloadArtifact({
	downloadName,
	mediaType,
	path,
}: ArtifactDownloadRequest): Promise<void> {
	const destination = new File(Paths.cache, safeDownloadName(downloadName));
	const file = await File.downloadFileAsync(absoluteApiDownloadUrl(path), destination, {
		headers: requestHeaders(),
		idempotent: true,
	});
	if (!(await Sharing.isAvailableAsync())) {
		throw new Error("Sharing is unavailable on this device.");
	}
	await Sharing.shareAsync(file.uri, {
		dialogTitle: `Share ${downloadName}`,
		mimeType: mediaType,
	});
}
