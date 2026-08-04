import { createHash } from "node:crypto";

import { normalizeGitRemoteIdentity } from "../shared/artifactRepositoryIdentity.ts";
import { decodeGitOutput, runGit } from "./git/index.ts";

export function fingerprintGitRemoteIdentity(identity: string): string {
	return createHash("sha256").update(identity).digest("hex");
}

export async function repositoryRemoteFingerprints(root: string): Promise<string[]> {
	const result = await runGit(root, ["config", "--get-regexp", "^remote\\..*\\.url$"], {
		allowExitCodes: [0, 1],
		maxOutputBytes: 1024 * 1024,
	});
	const fingerprints = decodeGitOutput(result.stdout)
		.split("\n")
		.flatMap((line) => {
			const separator = line.indexOf(" ");
			if (separator < 0) return [];
			const identity = normalizeGitRemoteIdentity(line.slice(separator + 1));
			return identity ? [fingerprintGitRemoteIdentity(identity)] : [];
		});
	return [...new Set(fingerprints)].sort();
}
