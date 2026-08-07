import * as Linking from "expo-linking";

import { absoluteApiDownloadUrl } from "../api.ts";
import type { ArtifactDownloadRequest } from "./artifactDownloadTypes.ts";

export async function downloadArtifact({ path }: ArtifactDownloadRequest): Promise<void> {
	await Linking.openURL(absoluteApiDownloadUrl(path));
}
