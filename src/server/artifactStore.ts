import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, type Dirent } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import {
	ARTIFACT_MAX_PAYLOAD_BYTES,
	type ArtifactBuild,
	type ArtifactDefinition,
} from "../shared/artifacts.ts";

interface ArtifactStoreOptions {
	root: string;
	maxPayloadBytes?: number;
	archiveMemoryLimitBytes?: number;
}

interface CaptureResult {
	downloadName: string;
	mediaType: string;
	sizeBytes: number;
	sha256: string;
	executable: boolean;
}

interface DirectoryEntry {
	archivePath: string;
	absolutePath: string;
	size: number;
	identity: FileIdentity;
}

interface DirectoryIdentity {
	absolutePath: string;
	identity: FileIdentity;
}

interface FileIdentity {
	dev: bigint;
	ino: bigint;
	size: bigint;
	mtimeNs: bigint;
	ctimeNs: bigint;
	mode: bigint;
}

function inside(root: string, candidate: string): boolean {
	return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function safeSegment(value: string): string {
	if (!value || value.length > 512 || !/^[A-Za-z0-9._-]+$/.test(value)) {
		throw new Error("Artifact storage identifier is invalid");
	}
	return value;
}

function safeDownloadName(value: string): string {
	if (
		!value ||
		value.length > 255 ||
		value === "." ||
		value === ".." ||
		value.includes("\0") ||
		value.includes("/") ||
		value.includes("\\")
	) {
		throw new Error("Artifact download filename is invalid");
	}
	return value;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw new Error("Artifact capture was cancelled");
}

async function fileIdentity(filePath: string): Promise<FileIdentity> {
	const metadata = await stat(filePath, { bigint: true });
	return {
		dev: metadata.dev,
		ino: metadata.ino,
		size: metadata.size,
		mtimeNs: metadata.mtimeNs,
		ctimeNs: metadata.ctimeNs,
		mode: metadata.mode,
	};
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.size === right.size &&
		left.mtimeNs === right.mtimeNs &&
		left.ctimeNs === right.ctimeNs &&
		left.mode === right.mode
	);
}

export class ArtifactStore {
	readonly root: string;
	private readonly maxPayloadBytes: number;
	private readonly archiveMemoryLimitBytes: number;

	constructor(options: ArtifactStoreOptions) {
		if (!path.isAbsolute(options.root)) throw new Error("Artifact store path must be absolute");
		this.root = options.root;
		this.maxPayloadBytes = options.maxPayloadBytes ?? ARTIFACT_MAX_PAYLOAD_BYTES;
		this.archiveMemoryLimitBytes = options.archiveMemoryLimitBytes ?? 64 * 1024 * 1024;
	}

	static besideDatabase(databasePath: string, maxPayloadBytes?: number): ArtifactStore {
		if (databasePath === ":memory:") {
			throw new Error("An explicit artifact store is required for an in-memory database");
		}
		return new ArtifactStore({
			root: path.join(path.dirname(databasePath), "artifacts"),
			maxPayloadBytes,
		});
	}

	async initialize(builds: readonly ArtifactBuild[]): Promise<string[]> {
		await this.ensurePrivateDirectory(this.root);
		const expected = new Set(
			builds.map((build) => this.buildDirectory(build.repositoryId, build.artifactId, build.id)),
		);
		await this.removeOrphans(expected);
		const missing: string[] = [];
		for (const build of builds) {
			const payload = this.payloadPath(build);
			const metadata = await stat(payload).catch(() => null);
			if (!metadata?.isFile() || metadata.size !== build.sizeBytes) missing.push(build.id);
		}
		return missing;
	}

	async capture(
		repositoryRoot: string,
		definition: ArtifactDefinition,
		buildId: string,
		signal: AbortSignal,
	): Promise<CaptureResult> {
		throwIfAborted(signal);
		const canonicalRoot = await realpath(repositoryRoot);
		const workingDirectory = path.resolve(canonicalRoot, ...definition.workingDirectory.split("/"));
		const canonicalWorkingDirectory = await realpath(workingDirectory).catch(() => null);
		if (!canonicalWorkingDirectory || !inside(canonicalRoot, canonicalWorkingDirectory)) {
			throw new Error("Artifact working directory resolves outside the repository");
		}
		const workingMetadata = await lstat(canonicalWorkingDirectory);
		if (!workingMetadata.isDirectory() || workingMetadata.isSymbolicLink()) {
			throw new Error("Artifact working directory is not a safe directory");
		}

		const output = path.resolve(canonicalWorkingDirectory, ...definition.outputPath.split("/"));
		if (!inside(canonicalRoot, output)) {
			throw new Error("Artifact output escapes the repository");
		}
		const outputMetadata = await lstat(output).catch(() => null);
		if (!outputMetadata) throw new Error("Artifact output does not exist after the command");
		if (outputMetadata.isSymbolicLink())
			throw new Error("Artifact output cannot be a symbolic link");
		const canonicalOutput = await realpath(output).catch(() => null);
		if (!canonicalOutput || !inside(canonicalRoot, canonicalOutput)) {
			throw new Error("Artifact output resolves outside the repository");
		}
		if (definition.outputKind === "file" && !outputMetadata.isFile()) {
			throw new Error("Artifact output is not the configured file kind");
		}
		if (definition.outputKind === "directory" && !outputMetadata.isDirectory()) {
			throw new Error("Artifact output is not the configured directory kind");
		}

		const buildDirectory = this.buildDirectory(definition.repositoryId, definition.id, buildId);
		await this.ensurePrivateDirectory(buildDirectory);
		try {
			return definition.outputKind === "file"
				? await this.captureFile(canonicalOutput, buildDirectory, signal)
				: await this.captureDirectory(canonicalRoot, canonicalOutput, buildDirectory, signal);
		} catch (error) {
			await rm(buildDirectory, { recursive: true, force: true });
			throw error;
		}
	}

	payloadPath(build: ArtifactBuild): string {
		return path.join(
			this.buildDirectory(build.repositoryId, build.artifactId, build.id),
			safeDownloadName(build.downloadName),
		);
	}

	async deleteBuild(
		build: Pick<ArtifactBuild, "repositoryId" | "artifactId" | "id">,
	): Promise<void> {
		await rm(this.buildDirectory(build.repositoryId, build.artifactId, build.id), {
			recursive: true,
			force: true,
		});
	}

	async deleteArtifact(repositoryId: string, artifactId: string): Promise<void> {
		await rm(path.join(this.repositoryDirectory(repositoryId), safeSegment(artifactId)), {
			recursive: true,
			force: true,
		});
	}

	async deleteRepository(repositoryId: string): Promise<void> {
		await rm(this.repositoryDirectory(repositoryId), { recursive: true, force: true });
	}

	private repositoryDirectory(repositoryId: string): string {
		return path.join(this.root, safeSegment(repositoryId));
	}

	private buildDirectory(repositoryId: string, artifactId: string, buildId: string): string {
		return path.join(
			this.repositoryDirectory(repositoryId),
			safeSegment(artifactId),
			safeSegment(buildId),
		);
	}

	private async captureFile(
		source: string,
		buildDirectory: string,
		signal: AbortSignal,
	): Promise<CaptureResult> {
		const sourceIdentity = await fileIdentity(source);
		if (sourceIdentity.size > BigInt(this.maxPayloadBytes)) {
			throw new Error(`Artifact input exceeds the ${this.maxPayloadBytes}-byte limit`);
		}
		const downloadName = safeDownloadName(path.basename(source));
		const destination = path.join(buildDirectory, downloadName);
		const temporary = path.join(buildDirectory, `.tmp-${randomUUID()}`);
		const hash = createHash("sha256");
		let sizeBytes = 0;
		const limiter = new Transform({
			transform: (chunk: Buffer, _encoding, callback) => {
				try {
					throwIfAborted(signal);
					sizeBytes += chunk.byteLength;
					if (sizeBytes > this.maxPayloadBytes) {
						throw new Error(`Artifact payload exceeds the ${this.maxPayloadBytes}-byte limit`);
					}
					hash.update(chunk);
					callback(null, chunk);
				} catch (error) {
					callback(error as Error);
				}
			},
		});
		await pipeline(
			createReadStream(source),
			limiter,
			createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
		);
		throwIfAborted(signal);
		const finalIdentity = await fileIdentity(source);
		if (sizeBytes !== Number(sourceIdentity.size) || !sameIdentity(sourceIdentity, finalIdentity)) {
			throw new Error("Artifact output changed while it was being captured");
		}
		await rename(temporary, destination);
		return {
			downloadName,
			mediaType: Bun.file(source).type || "application/octet-stream",
			sizeBytes,
			sha256: hash.digest("hex"),
			executable: (Number(sourceIdentity.mode) & 0o111) !== 0,
		};
	}

	private async captureDirectory(
		repositoryRoot: string,
		source: string,
		buildDirectory: string,
		signal: AbortSignal,
	): Promise<CaptureResult> {
		const entries: DirectoryEntry[] = [];
		const directories: DirectoryIdentity[] = [];
		await this.collectDirectoryEntries(
			repositoryRoot,
			source,
			source,
			entries,
			directories,
			signal,
		);
		const inputBytes = entries.reduce((total, entry) => total + entry.size, 0);
		if (inputBytes > this.maxPayloadBytes) {
			throw new Error(`Artifact input exceeds the ${this.maxPayloadBytes}-byte limit`);
		}
		const downloadName = safeDownloadName(`${path.basename(source)}.tar.gz`);
		const destination = path.join(buildDirectory, downloadName);
		const temporary = path.join(buildDirectory, `.tmp-${randomUUID()}`);
		throwIfAborted(signal);
		if (inputBytes <= this.archiveMemoryLimitBytes) {
			const archiveEntries: Record<string, Uint8Array> = {};
			for (const entry of entries) {
				const bytes = await readFile(entry.absolutePath);
				if (
					bytes.byteLength !== entry.size ||
					!sameIdentity(entry.identity, await fileIdentity(entry.absolutePath))
				) {
					throw new Error("Artifact output changed while it was being captured");
				}
				archiveEntries[entry.archivePath] = bytes;
			}
			await Bun.Archive.write(temporary, archiveEntries, { compress: "gzip" });
		} else {
			await this.writeLargeArchive(temporary, entries, signal);
		}
		throwIfAborted(signal);
		await this.assertDirectoryUnchanged(entries, directories);
		const archiveMetadata = await stat(temporary);
		if (archiveMetadata.size > this.maxPayloadBytes) {
			throw new Error(`Artifact payload exceeds the ${this.maxPayloadBytes}-byte limit`);
		}
		const sha256 = await this.hashFile(temporary, signal);
		await rename(temporary, destination);
		return {
			downloadName,
			mediaType: "application/gzip",
			sizeBytes: archiveMetadata.size,
			sha256,
			executable: false,
		};
	}

	private async collectDirectoryEntries(
		repositoryRoot: string,
		archiveRoot: string,
		current: string,
		entries: DirectoryEntry[],
		directories: DirectoryIdentity[],
		signal: AbortSignal,
	): Promise<void> {
		throwIfAborted(signal);
		const directoryIdentity = await fileIdentity(current);
		for (const entry of await readdir(current, { withFileTypes: true })) {
			if (entry.name === ".git") throw new Error("Artifact directories cannot contain .git");
			const absolutePath = path.join(current, entry.name);
			const metadata = await lstat(absolutePath);
			if (metadata.isSymbolicLink()) {
				throw new Error("Artifact directories cannot contain symbolic links");
			}
			const canonical = await realpath(absolutePath);
			if (!inside(repositoryRoot, canonical)) {
				throw new Error("Artifact directory entry resolves outside the repository");
			}
			if (entry.isDirectory()) {
				await this.collectDirectoryEntries(
					repositoryRoot,
					archiveRoot,
					canonical,
					entries,
					directories,
					signal,
				);
			} else if (entry.isFile()) {
				const identity = await fileIdentity(canonical);
				entries.push({
					archivePath: path.relative(archiveRoot, canonical).split(path.sep).join("/"),
					absolutePath: canonical,
					size: Number(identity.size),
					identity,
				});
			} else {
				throw new Error("Artifact directories can contain only regular files and directories");
			}
		}
		if (!sameIdentity(directoryIdentity, await fileIdentity(current))) {
			throw new Error("Artifact output changed while it was being captured");
		}
		directories.push({ absolutePath: current, identity: directoryIdentity });
	}

	private async assertDirectoryUnchanged(
		entries: readonly DirectoryEntry[],
		directories: readonly DirectoryIdentity[],
	): Promise<void> {
		for (const entry of entries) {
			if (!sameIdentity(entry.identity, await fileIdentity(entry.absolutePath))) {
				throw new Error("Artifact output changed while it was being captured");
			}
		}
		for (const directory of directories) {
			if (!sameIdentity(directory.identity, await fileIdentity(directory.absolutePath))) {
				throw new Error("Artifact output changed while it was being captured");
			}
		}
	}

	private async hashFile(filePath: string, signal: AbortSignal): Promise<string> {
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(filePath)) {
			throwIfAborted(signal);
			hash.update(chunk);
		}
		return hash.digest("hex");
	}

	private async writeLargeArchive(
		target: string,
		entries: readonly DirectoryEntry[],
		signal: AbortSignal,
	): Promise<void> {
		const input = new PassThrough();
		let storedBytes = 0;
		const limiter = new Transform({
			transform: (chunk: Buffer, _encoding, callback) => {
				storedBytes += chunk.byteLength;
				callback(
					storedBytes > this.maxPayloadBytes
						? new Error(`Artifact payload exceeds the ${this.maxPayloadBytes}-byte limit`)
						: null,
					chunk,
				);
			},
		});
		const writing = pipeline(
			input,
			createGzip(),
			limiter,
			createWriteStream(target, { flags: "wx", mode: 0o600 }),
		);
		try {
			for (const entry of entries) {
				throwIfAborted(signal);
				await this.writeArchiveBytes(input, this.tarHeader(entry));
				let copied = 0;
				for await (const chunk of createReadStream(entry.absolutePath)) {
					throwIfAborted(signal);
					const bytes = chunk as Buffer;
					copied += bytes.byteLength;
					await this.writeArchiveBytes(input, bytes);
				}
				if (copied !== entry.size) {
					throw new Error("Artifact output changed while it was being captured");
				}
				if (!sameIdentity(entry.identity, await fileIdentity(entry.absolutePath))) {
					throw new Error("Artifact output changed while it was being captured");
				}
				const padding = (512 - (copied % 512)) % 512;
				if (padding) await this.writeArchiveBytes(input, Buffer.alloc(padding));
			}
			await this.writeArchiveBytes(input, Buffer.alloc(1024));
			input.end();
			await writing;
		} catch (error) {
			input.destroy(error as Error);
			await writing.catch(() => undefined);
			throw error;
		}
	}

	private tarHeader(entry: DirectoryEntry): Buffer {
		let name = entry.archivePath;
		let prefix = "";
		if (Buffer.byteLength(name) > 100) {
			const separators = [...name.matchAll(/\//g)]
				.map((match) => match.index)
				.filter((index): index is number => index !== undefined)
				.reverse();
			const split = separators.find(
				(index) =>
					Buffer.byteLength(name.slice(0, index)) <= 155 &&
					Buffer.byteLength(name.slice(index + 1)) <= 100,
			);
			if (split === undefined) throw new Error("Artifact archive path is too long for tar");
			prefix = name.slice(0, split);
			name = name.slice(split + 1);
		}
		const header = Buffer.alloc(512);
		header.write(name, 0, 100, "utf8");
		this.writeTarOctal(header, 100, 8, 0o644);
		this.writeTarOctal(header, 108, 8, 0);
		this.writeTarOctal(header, 116, 8, 0);
		this.writeTarOctal(header, 124, 12, entry.size);
		this.writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
		header.fill(0x20, 148, 156);
		header[156] = 0x30;
		header.write("ustar\0", 257, 6, "ascii");
		header.write("00", 263, 2, "ascii");
		header.write(prefix, 345, 155, "utf8");
		this.writeTarOctal(
			header,
			148,
			8,
			header.reduce((sum, byte) => sum + byte, 0),
		);
		return header;
	}

	private writeTarOctal(buffer: Buffer, offset: number, length: number, value: number): void {
		const octal = value.toString(8).padStart(length - 1, "0");
		if (octal.length >= length) throw new Error("Artifact file is too large for tar");
		buffer.write(octal, offset, length - 1, "ascii");
		buffer[offset + length - 1] = 0;
	}

	private async writeArchiveBytes(stream: PassThrough, bytes: Uint8Array): Promise<void> {
		if (!stream.write(bytes)) await once(stream, "drain");
	}

	private async removeOrphans(expected: ReadonlySet<string>): Promise<void> {
		for (const repository of await this.safeDirectories(this.root)) {
			for (const artifact of await this.safeDirectories(path.join(this.root, repository.name))) {
				const artifactDirectory = path.join(this.root, repository.name, artifact.name);
				for (const build of await this.safeDirectories(artifactDirectory)) {
					const buildDirectory = path.join(artifactDirectory, build.name);
					if (!expected.has(buildDirectory)) {
						await rm(buildDirectory, { recursive: true, force: true });
						continue;
					}
					for (const entry of await readdir(buildDirectory, { withFileTypes: true })) {
						if (entry.name.startsWith(".tmp-")) {
							await rm(path.join(buildDirectory, entry.name), { recursive: true, force: true });
						}
					}
				}
			}
		}
	}

	private async ensurePrivateDirectory(directory: string): Promise<void> {
		const relative = path.relative(this.root, directory);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error("Artifact storage path escapes its private root");
		}
		await mkdir(this.root, { recursive: true, mode: 0o700 });
		const candidates = [
			this.root,
			...(relative && relative !== "."
				? relative
						.split(path.sep)
						.map((_, index, segments) => path.join(this.root, ...segments.slice(0, index + 1)))
				: []),
		];
		for (const candidate of candidates) {
			if (candidate !== this.root) {
				await mkdir(candidate, { mode: 0o700 }).catch((error) => {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				});
			}
			const metadata = await lstat(candidate);
			if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
				throw new Error("Artifact storage contains an unsafe directory");
			}
			await chmod(candidate, 0o700);
		}
	}

	private async safeDirectories(directory: string): Promise<Dirent[]> {
		return (await readdir(directory, { withFileTypes: true }).catch(() => [])).filter(
			(entry) => entry.isDirectory() && !entry.isSymbolicLink(),
		);
	}
}
