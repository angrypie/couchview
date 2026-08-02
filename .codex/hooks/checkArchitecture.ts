import { resolve } from "node:path";

type HookMode = "post" | "stop";

interface HookInput {
	stop_hook_active?: boolean;
}

function outputText(value: Uint8Array | undefined): string {
	return value ? new TextDecoder().decode(value).trim() : "";
}

const mode = process.argv[2] as HookMode | undefined;
if (mode !== "post" && mode !== "stop") {
	throw new Error("Expected hook mode 'post' or 'stop'.");
}

const inputText = await Bun.stdin.text();
const input = inputText ? (JSON.parse(inputText) as HookInput) : {};
const root = resolve(import.meta.dir, "../..");
const command =
	mode === "post"
		? ["bun", "run", "scripts/checkArchitecture.ts"]
		: ["bun", "run", "check:architecture"];
const result = Bun.spawnSync(command, {
	cwd: root,
	stderr: "pipe",
	stdout: "pipe",
});

if (result.success) {
	console.log("{}");
} else {
	const diagnostic = [outputText(result.stderr), outputText(result.stdout)]
		.filter(Boolean)
		.join("\n")
		.slice(0, 8_000);
	const reason = `Couchview architecture validation failed. Repair the reported violation without weakening policy.\n${diagnostic}`;
	if (mode === "stop" && input.stop_hook_active) {
		console.log(JSON.stringify({ continue: false, stopReason: reason }));
	} else {
		console.log(JSON.stringify({ decision: "block", reason }));
	}
}
