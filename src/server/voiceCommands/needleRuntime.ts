import { dlopen } from "bun:ffi";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import {
	VOICE_ACTION_DEFINITIONS,
	VOICE_ACTION_IDS,
	type VoiceActionId,
} from "../../shared/voiceCommands.ts";

const NEEDLE_ENGINE_VERSION = "2.0.2";
const NEEDLE_MODEL_REVISION = "17a803d95928ba33d3e9a0160e024d9565b5c3f2";
const MAX_RUNTIME_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;

interface NeedleEnvelope {
	type?: unknown;
	confidence?: unknown;
	function_calls?: unknown;
	reasoning?: unknown;
}

export interface NeedleResolution {
	actionIds: VoiceActionId[];
	confidence: number;
	reasoning: string | null;
}

export interface NeedleResolver {
	resolve(transcript: string): Promise<NeedleResolution>;
	close(): void;
}

interface NeedleSymbols {
	needle_init(system: unknown, tools: unknown, toolIndexPath: unknown): number;
	needle_complete(input: unknown, maxNewTokens: number, output: unknown, size: number): number;
	needle_reset(): void;
}

function nullTerminated(value: string): Buffer {
	return Buffer.from(`${value}\0`, "utf8");
}

interface NeedleToolSchema {
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, never>;
		additionalProperties: false;
	};
}

const ACTION_ID_BY_TOOL_NAME = new Map<string, VoiceActionId>(
	VOICE_ACTION_IDS.map((actionId) => [VOICE_ACTION_DEFINITIONS[actionId].toolName, actionId]),
);

export function needleToolSchemas(): NeedleToolSchema[] {
	return VOICE_ACTION_IDS.map((actionId) => {
		const definition = VOICE_ACTION_DEFINITIONS[actionId];
		return {
			name: definition.toolName,
			description: definition.description,
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
		};
	});
}

function toolsJson(): string {
	return JSON.stringify(needleToolSchemas());
}

function actionForCall(candidate: object): VoiceActionId | undefined {
	const name = (candidate as { name?: unknown }).name;
	if (typeof name !== "string") return;
	const argumentsValue = (candidate as { arguments?: unknown }).arguments;
	if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue))
		return;
	return ACTION_ID_BY_TOOL_NAME.get(name);
}

export function parseNeedleEnvelope(buffer: Buffer): NeedleResolution {
	const terminator = buffer.indexOf(0);
	const text = buffer.subarray(0, terminator < 0 ? buffer.length : terminator).toString("utf8");
	let envelope: NeedleEnvelope;
	try {
		envelope = JSON.parse(text) as NeedleEnvelope;
	} catch {
		throw new Error("Needle returned an invalid response envelope");
	}
	const confidence =
		typeof envelope.confidence === "number" && Number.isFinite(envelope.confidence)
			? Math.min(1, Math.max(0, envelope.confidence))
			: 0;
	const reasoning =
		typeof envelope.reasoning === "string" && envelope.reasoning.trim()
			? envelope.reasoning.trim()
			: null;
	if (!Array.isArray(envelope.function_calls)) return { actionIds: [], confidence, reasoning };
	const actionIds: VoiceActionId[] = [];
	for (const candidate of envelope.function_calls) {
		if (!candidate || typeof candidate !== "object") continue;
		const actionId = actionForCall(candidate);
		if (actionId) actionIds.push(actionId);
	}
	return { actionIds, confidence, reasoning };
}

export function openNeedleNativeResolver(libraryPath: string): NeedleResolver {
	const library = dlopen(libraryPath, {
		needle_init: { args: ["ptr", "ptr", "ptr"], returns: "i32" },
		needle_complete: { args: ["ptr", "i32", "ptr", "i32"], returns: "i32" },
		needle_reset: { args: [], returns: "void" },
	} as unknown as Parameters<typeof dlopen>[1]);
	const symbols = library.symbols as unknown as NeedleSymbols;
	// Needle's system field only accepts environment facts. Behavioral instructions there reduce
	// routing quality, so this mapper intentionally uses an empty system turn.
	const system = nullTerminated("");
	const tools = nullTerminated(toolsJson());
	const toolIndex = nullTerminated(path.join(path.dirname(libraryPath), "voice-tools.index"));
	if (symbols.needle_init(system, tools, toolIndex) < 0) {
		library.close();
		throw new Error("Needle runtime initialization failed");
	}
	let closed = false;
	return {
		async resolve(transcript) {
			if (closed) throw new Error("Needle runtime is closed");
			// Voice utterances are independent. Without a reset, Needle treats each transcript as the
			// next turn in the preceding command's tool loop and can reuse stale intent.
			symbols.needle_reset();
			const output = Buffer.alloc(MAX_RESPONSE_BYTES);
			const result = symbols.needle_complete(
				nullTerminated(transcript),
				128,
				output,
				output.length,
			);
			if (result < 0) throw new Error(`Needle inference failed (${result})`);
			return parseNeedleEnvelope(output);
		},
		close() {
			if (closed) return;
			closed = true;
			symbols.needle_reset();
			library.close();
		},
	};
}

interface RuntimePlatform {
	libraryName: string;
	tag: string;
}

function runtimePlatform(): RuntimePlatform {
	const override = Bun.env.COUCHVIEW_NEEDLE_PLATFORM_TAG;
	if (override) {
		if (
			!/^(?:macosx_11_0_(?:arm64|x86_64)|manylinux2014_(?:aarch64|x86_64)|musllinux_1_2_(?:aarch64|x86_64)|win_(?:arm64|amd64))$/.test(
				override,
			)
		) {
			throw new Error("COUCHVIEW_NEEDLE_PLATFORM_TAG is invalid");
		}
		return {
			libraryName: override.startsWith("macosx")
				? "libneedle.dylib"
				: override.startsWith("win")
					? "libneedle.dll"
					: "libneedle.so",
			tag: override,
		};
	}
	const arm = process.arch === "arm64";
	if (process.platform === "darwin") {
		return { libraryName: "libneedle.dylib", tag: `macosx_11_0_${arm ? "arm64" : "x86_64"}` };
	}
	if (process.platform === "win32") {
		return { libraryName: "libneedle.dll", tag: `win_${arm ? "arm64" : "amd64"}` };
	}
	if (process.platform === "linux") {
		return {
			libraryName: "libneedle.so",
			tag: `manylinux2014_${arm ? "aarch64" : "x86_64"}`,
		};
	}
	throw new Error(`Needle does not support ${process.platform}/${process.arch}`);
}

function findEndOfCentralDirectory(archive: Buffer): number {
	const minimum = Math.max(0, archive.length - 65_557);
	for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
		if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
	}
	throw new Error("Needle runtime archive is invalid");
}

function extractWheelEntry(archive: Buffer, entryName: string): Buffer {
	const eocd = findEndOfCentralDirectory(archive);
	const entries = archive.readUInt16LE(eocd + 10);
	let offset = archive.readUInt32LE(eocd + 16);
	for (let index = 0; index < entries; index += 1) {
		if (archive.readUInt32LE(offset) !== 0x02014b50) break;
		const compression = archive.readUInt16LE(offset + 10);
		const compressedSize = archive.readUInt32LE(offset + 20);
		const uncompressedSize = archive.readUInt32LE(offset + 24);
		const nameLength = archive.readUInt16LE(offset + 28);
		const extraLength = archive.readUInt16LE(offset + 30);
		const commentLength = archive.readUInt16LE(offset + 32);
		const localOffset = archive.readUInt32LE(offset + 42);
		const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
		if (name === entryName) {
			if (uncompressedSize > MAX_RUNTIME_DOWNLOAD_BYTES) {
				throw new Error("Needle runtime library is unexpectedly large");
			}
			if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
				throw new Error("Needle runtime archive entry is invalid");
			}
			const localNameLength = archive.readUInt16LE(localOffset + 26);
			const localExtraLength = archive.readUInt16LE(localOffset + 28);
			const start = localOffset + 30 + localNameLength + localExtraLength;
			const compressed = archive.subarray(start, start + compressedSize);
			const result = compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
			if (result.length !== uncompressedSize) {
				throw new Error("Needle runtime library size does not match its archive");
			}
			return result;
		}
		offset += 46 + nameLength + extraLength + commentLength;
	}
	throw new Error("Needle runtime archive does not contain its native library");
}

async function readBoundedDownload(response: Response): Promise<Buffer> {
	if (!response.body) throw new Error("Needle runtime download returned no content");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			total += chunk.value.byteLength;
			if (total > MAX_RUNTIME_DOWNLOAD_BYTES) {
				throw new Error("Needle runtime download is unexpectedly large");
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks, total);
}

export async function ensureNeedleLibrary(storageDirectory: string): Promise<string> {
	const platform = runtimePlatform();
	const directory = path.join(storageDirectory, NEEDLE_ENGINE_VERSION, platform.tag);
	const target = path.join(directory, platform.libraryName);
	if ((await stat(target).catch(() => null))?.isFile()) return target;
	await mkdir(directory, { recursive: true });
	const wheel = `cactus_needle-${NEEDLE_ENGINE_VERSION}-py3-none-${platform.tag}.whl`;
	const url =
		`https://huggingface.co/Cactus-Compute/needle2/resolve/${NEEDLE_MODEL_REVISION}/` +
		`python/${wheel}`;
	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok) throw new Error(`Needle runtime download failed (${response.status})`);
	const declaredSize = Number(response.headers.get("content-length") ?? 0);
	if (declaredSize > MAX_RUNTIME_DOWNLOAD_BYTES) {
		throw new Error("Needle runtime download is unexpectedly large");
	}
	const archive = await readBoundedDownload(response);
	const library = extractWheelEntry(archive, `needle/${platform.libraryName}`);
	const temporary = `${target}.${crypto.randomUUID()}.tmp`;
	await Bun.write(temporary, library);
	await rename(temporary, target);
	return target;
}
