import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface ArchitectureViolation {
	file: string;
	message: string;
	rule: "boundary" | "suppression";
}

export interface ArchitectureReport {
	checkedFiles: number;
	violations: ArchitectureViolation[];
}

// Biome owns generic concerns such as file size, complexity, cycles, and lint rules. This
// checker stays deliberately small and enforces only Couchview-specific dependency direction
// and the repository's ban on inline rule bypasses.
export const ARCHITECTURE_ROOTS = ["src", "scripts", ".codex/hooks"] as const;
const SOURCE_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);

// Match quoted module specifiers in static imports, re-exports, and literal dynamic imports.
// This is intentionally a lightweight raw-source scan, not a TypeScript module-graph parser.
const IMPORT_PATTERN =
	/(?:import|export)\s+(?:type\s+)?(?:[^"']*?\sfrom\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

const GIT_MODULE_BOUNDARIES: ReadonlyArray<{
	directory: string;
	entries: ReadonlySet<string>;
}> = [
	{
		directory: "src/shared/git/",
		entries: new Set(["src/shared/git/index.ts"]),
	},
	{
		directory: "src/client/features/git/",
		entries: new Set(["src/client/features/git/index.ts"]),
	},
	{
		directory: "src/client/components/git/",
		entries: new Set(["src/client/components/git/index.ts", "src/client/components/git/index.css"]),
	},
	{
		directory: "src/server/git/",
		entries: new Set(["src/server/git/index.ts"]),
	},
] as const;

async function sourceFiles(root: string, directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === "dist") continue;
		const absolute = resolve(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await sourceFiles(root, absolute)));
		else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
			files.push(relative(root, absolute).replaceAll("\\", "/"));
		}
	}
	return files;
}

function resolvedRelativeImport(root: string, path: string, specifier: string): string | null {
	// Package names and aliases are outside these repository-layer checks. Resolving relative
	// specifiers first makes the rules independent of the importing file's directory depth and
	// normalizes paths containing `..` before comparing architectural areas.
	if (!specifier.startsWith(".")) return null;
	return resolve(root, path, "..", specifier).replaceAll("\\", "/");
}

function boundaryViolations(root: string, path: string, source: string): ArchitectureViolation[] {
	const violations: ArchitectureViolation[] = [];
	for (const match of source.matchAll(IMPORT_PATTERN)) {
		const specifier = match[1] ?? match[2];
		if (!specifier) continue;
		const target = resolvedRelativeImport(root, path, specifier);
		if (!target) continue;
		const targetPath = relative(root, target).replaceAll("\\", "/");
		const gitModule = GIT_MODULE_BOUNDARIES.find(({ directory }) =>
			targetPath.startsWith(directory),
		);
		const deepGitModuleImport = Boolean(
			gitModule && !path.startsWith(gitModule.directory) && !gitModule.entries.has(targetPath),
		);

		// App is wiring only: all internal dependencies must enter through an explicitly owned
		// feature, presentation component, or small feature-neutral client utility.
		const appInternalImport =
			path === "src/client/App.tsx" &&
			!["/src/client/components/", "/src/client/features/", "/src/client/lib/"].some((segment) =>
				target.includes(segment),
			);

		// Browser code must reach Bun, Git, persistence, and process functionality through shared
		// contracts and the server API instead of importing a server implementation directly.
		const clientImportsServer = path.startsWith("src/client/") && target.includes("/src/server/");

		// Shared contracts must remain usable without pulling in either runtime implementation.
		const sharedImportsRuntime =
			path.startsWith("src/shared/") &&
			(target.includes("/src/client/") || target.includes("/src/server/"));

		// Features own state and workflows. Depending on presentation would reverse that ownership;
		// components may consume feature controllers, but features may not consume components.
		const featureImportsComponent =
			path.startsWith("src/client/features/") && target.includes("/src/client/components/");
		if (
			appInternalImport ||
			clientImportsServer ||
			sharedImportsRuntime ||
			featureImportsComponent ||
			deepGitModuleImport
		) {
			violations.push({
				file: path,
				message: `forbidden import boundary: ${specifier}`,
				rule: "boundary",
			});
		}
	}
	return violations;
}

export async function checkArchitecture(
	root: string,
	roots: readonly string[] = ARCHITECTURE_ROOTS,
): Promise<ArchitectureReport> {
	const files = (
		await Promise.all(roots.map((directory) => sourceFiles(root, resolve(root, directory))))
	)
		.flat()
		.sort();
	const violations: ArchitectureViolation[] = [];
	for (const path of files) {
		const source = await readFile(resolve(root, path), "utf8");

		// Keep exceptions visible in central policy instead of allowing a file to silence Biome or
		// TypeScript locally. The expression covers both `biome-ignore` and `biome-ignore-all` line
		// directives, plus `@ts-nocheck`.
		if (/^\s*\/\/\s*(?:biome-ignore|@ts-nocheck)\b/m.test(source)) {
			violations.push({
				file: path,
				message: "inline Biome or TypeScript blanket suppression is not allowed",
				rule: "suppression",
			});
		}
		violations.push(...boundaryViolations(root, path, source));
	}
	return { checkedFiles: files.length, violations };
}

async function main() {
	const root = resolve(import.meta.dir, "..");
	const report = await checkArchitecture(root);
	if (process.argv.includes("--json")) {
		console.log(JSON.stringify(report, null, 2));
	} else if (report.violations.length === 0) {
		console.log(`Architecture check passed (${report.checkedFiles} files).`);
	} else {
		console.error(`Architecture check failed (${report.violations.length} violations):`);
		for (const violation of report.violations) {
			console.error(`- ${violation.file} [${violation.rule}]: ${violation.message}`);
		}
	}
	if (report.violations.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main();
}
