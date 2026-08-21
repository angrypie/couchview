import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Builds the shared Oniguruma core into `build/nitro-onig-core.dylib` so the
 * host parity harness (bun:ffi) can drive the exact same scanner code the
 * Nitro module runs. Dev-host only; the dylib is never shipped.
 */

const ROOT = import.meta.dir;
const MODULE = join(ROOT, "..", "nitro_modules", "nitro-oniguruma");
const VENDOR = join(MODULE, "vendor", "oniguruma");
const CPP = join(MODULE, "cpp");
const OUT_DIR = join(ROOT, "..", "build");
const OBJ_DIR = join(OUT_DIR, "nitro-onig-obj");
const OUT = join(OUT_DIR, "nitro-onig-core.dylib");

function newer(source: string, target: string): boolean {
	try {
		return statSync(source).mtimeMs > statSync(target).mtimeMs;
	} catch {
		return true;
	}
}

// Data files that unicode.c textually #includes; they must not be compiled
// standalone (matches the oniguruma automake source list the WASM build used).
const INCLUDED_DATA_FILES = new Set([
	"unicode_fold_data.c",
	"unicode_property_data.c",
	"unicode_egcb_data.c",
	"unicode_wb_data.c",
]);

function vendorSources(): string[] {
	return readdirSync(VENDOR)
		.filter((name) => name.endsWith(".c") && !INCLUDED_DATA_FILES.has(name))
		.map((name) => join(VENDOR, name));
}

async function run(compiler: string, args: string[], label: string): Promise<void> {
	const proc = Bun.spawn([compiler, ...args], {
		cwd: ROOT,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) throw new Error(`${compiler} ${label} failed with exit code ${exitCode}`);
}

export async function buildNitroOnigCore(): Promise<string> {
	const cSources = vendorSources();
	const cppSources = [join(CPP, "OnigCore.cpp"), join(CPP, "OnigCoreAbi.cpp")];
	const inputs = [
		join(CPP, "OnigCore.hpp"),
		join(CPP, "OnigCoreAbi.cpp"),
		join(VENDOR, "oniguruma.h"),
		join(VENDOR, "config.h"),
		...cSources,
		...cppSources,
	];
	const stale = inputs.some((source) => newer(source, OUT));
	if (!stale) return OUT;

	rmSync(OBJ_DIR, { recursive: true, force: true });
	mkdirSync(OBJ_DIR, { recursive: true });
	const objects: string[] = [];

	for (const source of cSources) {
		const object = join(OBJ_DIR, source.slice(VENDOR.length + 1, -2) + ".o");
		await run("clang", ["-O2", "-fPIC", "-I", VENDOR, "-c", source, "-o", object], "C compile");
		objects.push(object);
	}
	for (const source of cppSources) {
		const object = join(OBJ_DIR, source.slice(CPP.length + 1, -4) + ".o");
		await run(
			"clang",
			["-O2", "-fPIC", "-std=c++20", "-I", VENDOR, "-I", CPP, "-c", source, "-o", object],
			"C++ compile",
		);
		objects.push(object);
	}
	// xcrun resolves the active Xcode toolchain; clang++ links libc++ for the
	// C++ stdlib symbols (std::string etc.) used by OnigCore.
	await run("xcrun", ["clang++", "-shared", ...objects, "-o", OUT], "link");
	console.log(`built ${relative(ROOT, OUT)} (${objects.length} objects)`);
	return OUT;
}

if (import.meta.main) {
	await buildNitroOnigCore();
}
