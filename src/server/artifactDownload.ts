import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { ARTIFACT_EXECUTABLE_HEADER, type ArtifactBuild } from "../shared/artifacts.ts";
import { HttpError } from "./errors.ts";

interface ByteRange {
	start: number;
	end: number;
}

function parseRange(value: string | null, size: number): ByteRange | null {
	if (!value) return null;
	if (!value.startsWith("bytes=") || value.includes(",")) {
		throw new HttpError(416, "artifact_range_invalid", "Only one byte range is supported");
	}
	const match = /^(\d*)-(\d*)$/.exec(value.slice(6));
	if (!match || (!match[1] && !match[2]) || size === 0) {
		throw new HttpError(416, "artifact_range_invalid", "Artifact byte range is invalid");
	}
	let start: number;
	let end: number;
	if (!match[1]) {
		const suffix = Number(match[2]);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) {
			throw new HttpError(416, "artifact_range_invalid", "Artifact byte range is invalid");
		}
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(match[1]);
		end = match[2] ? Number(match[2]) : size - 1;
		if (
			!Number.isSafeInteger(start) ||
			!Number.isSafeInteger(end) ||
			start < 0 ||
			start >= size ||
			end < start
		) {
			throw new HttpError(416, "artifact_range_invalid", "Artifact byte range is invalid");
		}
		end = Math.min(end, size - 1);
	}
	return { start, end };
}

function contentDisposition(filename: string): string {
	const fallback = filename.replace(/[^A-Za-z0-9._-]/g, "_") || "artifact";
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function artifactDownloadResponse(
	request: Request,
	build: ArtifactBuild,
	filePath: string,
): Response {
	const etag = `"${build.sha256}"`;
	const headers = new Headers({
		"Accept-Ranges": "bytes",
		"Cache-Control": "private, no-store",
		"Content-Disposition": contentDisposition(build.downloadName),
		"Content-Type": build.mediaType,
		[ARTIFACT_EXECUTABLE_HEADER]: build.executable ? "1" : "0",
		ETag: etag,
	});
	let range: ByteRange | null;
	try {
		range =
			request.headers.get("if-range") && request.headers.get("if-range") !== etag
				? null
				: parseRange(request.headers.get("range"), build.sizeBytes);
	} catch (error) {
		if (!(error instanceof HttpError) || error.status !== 416) throw error;
		headers.set("Content-Range", `bytes */${build.sizeBytes}`);
		return new Response(null, { status: 416, headers });
	}
	if (request.headers.get("if-none-match") === etag && !range) {
		return new Response(null, { status: 304, headers });
	}
	const start = range?.start ?? 0;
	const end = range?.end ?? Math.max(0, build.sizeBytes - 1);
	const length = range ? end - start + 1 : build.sizeBytes;
	headers.set("Content-Length", String(length));
	if (range) headers.set("Content-Range", `bytes ${start}-${end}/${build.sizeBytes}`);
	const body =
		request.method === "HEAD"
			? null
			: range
				? (Readable.toWeb(
						createReadStream(filePath, { start, end }),
					) as unknown as ReadableStream<Uint8Array>)
				: Bun.file(filePath);
	return new Response(body, { status: range ? 206 : 200, headers });
}
