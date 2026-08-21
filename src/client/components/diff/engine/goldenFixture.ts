import type { TokenRun } from "./types.ts";

/**
 * Fixture gauntlet shared by the golden snapshot test, the host FFI parity
 * test, and the dev-only bench screen (which prints the same fingerprints on
 * device so native engines can be compared against the host reference).
 */

export interface GoldenFixture {
	lang: string;
	lines: string[];
}

export const GOLDEN_FIXTURES: Record<string, GoldenFixture> = {
	tsx: {
		lang: "tsx",
		lines: [
			"export interface ReviewOptions {",
			"  enabled: boolean;",
			"  // a comment about nothing in particular",
			"  label: string;",
			"}",
			"",
			"/* multi",
			"line block",
			"comment */",
			"export function render(count: number): JSX.Element {",
			"  const items = useMemo(() => count > 3 ? [1, 2, 3] : [], [count]);",
			"  const label = `item-${count}`;",
			"  const body = `multi",
			"line ${count} template`;",
			'  return <div className="row">{items.map((n) => <span key={n}>{label}{n}</span>)}</div>;',
			"}",
			"",
			"const noNewlineHere = true;",
		],
	},
	python: {
		lang: "python",
		lines: [
			"def render(count: int) -> str:",
			'    """Docstring',
			"    spanning lines",
			'    """',
			"    if count > 3:",
			'        return f"item-{count}"',
			'    return "fallback"',
		],
	},
	shellscript: {
		lang: "shellscript",
		lines: [
			"#!/bin/sh",
			'if [ -n "$1" ]; then',
			"  cat <<'EOF'",
			"multi-line heredoc",
			"with $unexpanded vars",
			"EOF",
			"fi",
		],
	},
};

/**
 * Char-level fingerprint of a row: each character gets its resolved color
 * and font-style bits. Token *boundaries* are ignored — engines may split
 * spans at slightly different offsets, but the rendered colors must match.
 */
export function charFingerprint(
	runs: readonly TokenRun[] | null | undefined,
	rowText: string,
): string {
	const cells: string[] = new Array(rowText.length).fill("");
	let cursor = 0;
	for (const run of runs ?? []) {
		const index = rowText.indexOf(run.text, cursor);
		if (index === -1) continue;
		const style = `${run.color}|${run.bold ? "b" : ""}${run.italic ? "i" : ""}${run.underline ? "u" : ""}`;
		for (let offset = index; offset < index + run.text.length && offset < cells.length; offset++) {
			cells[offset] = style;
		}
		cursor = index + run.text.length;
	}
	return cells.join("\n");
}

/**
 * Stable identifier for a full fixture run — the concatenated char-level
 * fingerprints of every row, so host and device can compare rendered output
 * without shipping token JSON.
 */
export function goldenFixtureFingerprint(
	tokens: ReadonlyMap<string, readonly TokenRun[]>,
	rows: readonly { id: string; text: string }[],
): string {
	const parts: string[] = [];
	for (const fixtureRow of rows) {
		parts.push(charFingerprint(tokens.get(fixtureRow.id) ?? null, fixtureRow.text));
	}
	return parts.join("\n---\n");
}

/** Compact djb2 hash of a fingerprint, for one-line host/device comparison. */
export function fingerprintHash(fingerprint: string): string {
	let hash = 5381;
	for (let i = 0; i < fingerprint.length; i++) {
		hash = (hash * 33) ^ fingerprint.charCodeAt(i);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
