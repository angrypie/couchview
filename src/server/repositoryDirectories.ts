import { readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { RepositoryDirectoryListing } from "../shared/repositoryDirectories.ts";
import { HttpError } from "./errors.ts";

const MAX_DIRECTORY_ENTRIES = 500;

function compareDirectoryNames(left: string, right: string): number {
	const hiddenOrder = Number(left.startsWith(".")) - Number(right.startsWith("."));
	if (hiddenOrder !== 0) return hiddenOrder;
	const normalizedLeft = left.toLowerCase();
	const normalizedRight = right.toLowerCase();
	if (normalizedLeft !== normalizedRight) return normalizedLeft < normalizedRight ? -1 : 1;
	return left === right ? 0 : left < right ? -1 : 1;
}

function errorCode(error: unknown): string | null {
	return error && typeof error === "object" && "code" in error
		? String((error as { code?: unknown }).code ?? "")
		: null;
}

function directoryAccessError(error: unknown, missingMessage: string): HttpError {
	const code = errorCode(error);
	if (code === "EACCES" || code === "EPERM") {
		return new HttpError(403, "directory_access_denied", "Couchview cannot read this directory");
	}
	if (code === "ENOENT") {
		return new HttpError(404, "directory_not_found", missingMessage);
	}
	if (code === "ENOTDIR") {
		return new HttpError(400, "directory_invalid", "The selected path is not a directory");
	}
	return new HttpError(400, "directory_unavailable", "The selected directory is unavailable");
}

export async function listRepositoryDirectories(
	candidate: string | null,
): Promise<RepositoryDirectoryListing> {
	const requested = candidate?.trim() || homedir();
	if (!path.isAbsolute(requested) || requested.length > 32_768) {
		throw new HttpError(400, "directory_invalid", "Directory path must be absolute");
	}
	let directory: string;
	try {
		directory = await realpath(requested);
	} catch (error) {
		throw directoryAccessError(error, "The selected directory does not exist");
	}
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		throw directoryAccessError(error, "The selected directory no longer exists");
	}
	const directories = entries
		.filter((entry) => entry.isDirectory())
		.sort((left, right) => compareDirectoryNames(left.name, right.name));
	const parent = path.dirname(directory);
	return {
		directories: directories.slice(0, MAX_DIRECTORY_ENTRIES).map((entry) => ({
			name: entry.name,
			path: path.join(directory, entry.name),
		})),
		parent: parent === directory ? null : parent,
		path: directory,
		truncated: directories.length > MAX_DIRECTORY_ENTRIES,
	};
}
