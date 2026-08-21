import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE_DIR = "src/client/assets/fonts";
const TARGET_DIR = "src/client/assets/fonts/ttf";

mkdirSync(TARGET_DIR, { recursive: true });

const faces = ["Iosevka-Regular", "Iosevka-Bold"];

for (const face of faces) {
	const source = join(SOURCE_DIR, `${face}.woff2`);
	const target = join(TARGET_DIR, `${face}.ttf`);
	const sourceStat = statSync(source);
	const targetStat = (() => {
		try {
			return statSync(target);
		} catch {
			return null;
		}
	})();
	if (targetStat && targetStat.mtimeMs >= sourceStat.mtimeMs) {
		console.log(`skip ${face} (fresh)`);
		continue;
	}
	execFileSync(
		"python3",
		[
			"-c",
			`
from fontTools.ttLib import TTFont
import sys
font = TTFont("${source}")
font.flavor = None
font.save("${target}")
print("converted ${face} -> ttf")
`,
		],
		{ stdio: "inherit" },
	);
}

console.log("fonts:", readdirSync(TARGET_DIR).join(", "));
