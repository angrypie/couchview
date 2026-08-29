import uFuzzy from "@leeoniya/ufuzzy";

const matcher = new uFuzzy({
	interBound: "[^\\p{L}\\d]",
	interSplit: "[^\\p{L}\\d]+",
	intraBound: "\\p{L}\\d|\\d\\p{L}|\\p{Ll}\\p{Lu}",
	intraChars: "[\\p{L}\\d\\p{P}\\p{Z}]",
	intraContr: "'\\p{L}{1,2}\\b",
	intraIns: Number.POSITIVE_INFINITY,
	intraSplit: "\\p{Ll}\\p{Lu}",
	unicode: true,
});

const MATCH_SCORE = 16;
const GAP_OPEN_SCORE = -3;
const GAP_EXTENSION_SCORE = -1;
const BOUNDARY_BONUS = 8;
const CAMEL_OR_NUMBER_BONUS = 7;
const CONSECUTIVE_BONUS = 4;
const BASENAME_TERM_BONUS = 24;
const NO_SCORE = -1_000_000_000;
const unicodeWordCharacter = /[\p{L}\p{N}]/u;
const unicodeLowercaseCharacter = /\p{Ll}/u;
const unicodeUppercaseCharacter = /\p{Lu}/u;
const unicodeNumberCharacter = /\p{N}/u;

export type FuzzyQuickPickScheme = "default" | "path";

export interface FuzzyQuickPickOptions {
	scheme?: FuzzyQuickPickScheme;
}

interface SearchRecord {
	basenameStart: number;
	foldedText: string;
	text: string;
}

interface RankedIndex {
	basenameTerms: number;
	gaps: number;
	index: number;
	score: number;
	span: number;
	textLength: number;
}

interface TermScore {
	inBasename: boolean;
	gaps: number;
	score: number;
	span: number;
}

interface ScoreScratch {
	currentGaps: Int32Array;
	currentScores: Int32Array;
	currentStarts: Int32Array;
	previousGaps: Int32Array;
	previousScores: Int32Array;
	previousStarts: Int32Array;
}

function cappedLength(length: number, limit: number): number {
	if (limit === Number.POSITIVE_INFINITY) return length;
	if (!Number.isFinite(limit)) return 0;
	return Math.min(length, Math.max(0, Math.floor(limit)));
}

function isAsciiDigit(code: number): boolean {
	return code >= 48 && code <= 57;
}

function isAsciiLowercase(code: number): boolean {
	return code >= 97 && code <= 122;
}

function isAsciiUppercase(code: number): boolean {
	return code >= 65 && code <= 90;
}

function isWordCharacter(character: string, code: number): boolean {
	if (code < 128) {
		return isAsciiDigit(code) || isAsciiLowercase(code) || isAsciiUppercase(code);
	}
	return unicodeWordCharacter.test(character);
}

function isLowercaseCharacter(character: string, code: number): boolean {
	return code < 128 ? isAsciiLowercase(code) : unicodeLowercaseCharacter.test(character);
}

function isUppercaseCharacter(character: string, code: number): boolean {
	return code < 128 ? isAsciiUppercase(code) : unicodeUppercaseCharacter.test(character);
}

function isNumberCharacter(character: string, code: number): boolean {
	return code < 128 ? isAsciiDigit(code) : unicodeNumberCharacter.test(character);
}

function characterBonus(text: string, position: number): number {
	if (position === 0) return BOUNDARY_BONUS;
	const current = text[position]!;
	const previous = text[position - 1]!;
	const currentCode = text.charCodeAt(position);
	const previousCode = text.charCodeAt(position - 1);
	if (!isWordCharacter(previous, previousCode)) return BOUNDARY_BONUS;
	if (
		(isLowercaseCharacter(previous, previousCode) && isUppercaseCharacter(current, currentCode)) ||
		(isNumberCharacter(previous, previousCode) !== isNumberCharacter(current, currentCode) &&
			isWordCharacter(current, currentCode))
	) {
		return CAMEL_OR_NUMBER_BONUS;
	}
	return 0;
}

function isBetterState(
	score: number,
	gaps: number,
	start: number,
	currentScore: number,
	currentGaps: number,
	currentStart: number,
): boolean {
	return (
		score > currentScore ||
		(score === currentScore &&
			(gaps < currentGaps || (gaps === currentGaps && start > currentStart)))
	);
}

function createScoreScratch(length: number): ScoreScratch {
	return {
		currentGaps: new Int32Array(length),
		currentScores: new Int32Array(length),
		currentStarts: new Int32Array(length),
		previousGaps: new Int32Array(length),
		previousScores: new Int32Array(length),
		previousStarts: new Int32Array(length),
	};
}

function scoreTerm(
	record: SearchRecord,
	term: string,
	scheme: FuzzyQuickPickScheme,
	scratch: ScoreScratch,
): TermScore | null {
	const length = record.foldedText.length;
	if (term.length === 0 || length === 0 || term.length > length) return null;

	let previousScores = scratch.previousScores;
	let previousStarts = scratch.previousStarts;
	let previousGaps = scratch.previousGaps;
	let currentScores = scratch.currentScores;
	let currentStarts = scratch.currentStarts;
	let currentGaps = scratch.currentGaps;
	previousScores.fill(NO_SCORE, 0, length);

	for (let position = 0; position < length; position += 1) {
		if (record.foldedText[position] !== term[0]) continue;
		const inBasename = scheme === "path" && position >= record.basenameStart;
		previousScores[position] =
			MATCH_SCORE +
			characterBonus(record.text, position) * 2 +
			(inBasename ? BASENAME_TERM_BONUS : 0);
		previousStarts[position] = position;
		previousGaps[position] = 0;
	}

	for (let termIndex = 1; termIndex < term.length; termIndex += 1) {
		currentScores.fill(NO_SCORE, 0, length);
		let bestGapAdjustedScore = NO_SCORE;
		let bestGapAdjustedGaps = Number.POSITIVE_INFINITY;
		let bestGapIndex = -1;

		for (let position = 0; position < length; position += 1) {
			const eligibleGapIndex = position - 2;
			if (eligibleGapIndex >= 0 && previousScores[eligibleGapIndex]! > NO_SCORE) {
				const adjustedScore =
					previousScores[eligibleGapIndex]! - GAP_EXTENSION_SCORE * eligibleGapIndex;
				const adjustedGaps = previousGaps[eligibleGapIndex]! - eligibleGapIndex;
				if (
					adjustedScore > bestGapAdjustedScore ||
					(adjustedScore === bestGapAdjustedScore &&
						(adjustedGaps < bestGapAdjustedGaps ||
							(adjustedGaps === bestGapAdjustedGaps &&
								previousStarts[eligibleGapIndex]! > (previousStarts[bestGapIndex] ?? -1))))
				) {
					bestGapAdjustedScore = adjustedScore;
					bestGapAdjustedGaps = adjustedGaps;
					bestGapIndex = eligibleGapIndex;
				}
			}

			if (record.foldedText[position] !== term[termIndex]) continue;
			const bonus = characterBonus(record.text, position);
			let selectedScore = NO_SCORE;
			let selectedStart = -1;
			let selectedGaps = Number.POSITIVE_INFINITY;

			const consecutiveIndex = position - 1;
			if (consecutiveIndex >= 0 && previousScores[consecutiveIndex]! > NO_SCORE) {
				selectedScore =
					previousScores[consecutiveIndex]! + MATCH_SCORE + Math.max(CONSECUTIVE_BONUS, bonus);
				selectedStart = previousStarts[consecutiveIndex]!;
				selectedGaps = previousGaps[consecutiveIndex]!;
			}

			if (bestGapIndex >= 0) {
				const gapLength = position - bestGapIndex - 1;
				const gapScore =
					previousScores[bestGapIndex]! +
					MATCH_SCORE +
					bonus +
					GAP_OPEN_SCORE +
					GAP_EXTENSION_SCORE * (gapLength - 1);
				const gapStart = previousStarts[bestGapIndex]!;
				const gapCount = previousGaps[bestGapIndex]! + gapLength;
				if (
					isBetterState(gapScore, gapCount, gapStart, selectedScore, selectedGaps, selectedStart)
				) {
					selectedScore = gapScore;
					selectedStart = gapStart;
					selectedGaps = gapCount;
				}
			}

			if (selectedScore > NO_SCORE) {
				currentScores[position] = selectedScore;
				currentStarts[position] = selectedStart;
				currentGaps[position] = selectedGaps;
			}
		}

		[previousScores, currentScores] = [currentScores, previousScores];
		[previousStarts, currentStarts] = [currentStarts, previousStarts];
		[previousGaps, currentGaps] = [currentGaps, previousGaps];
	}

	let bestScore = NO_SCORE;
	let bestStart = -1;
	let bestEnd = -1;
	let bestGaps = Number.POSITIVE_INFINITY;
	for (let position = 0; position < length; position += 1) {
		const score = previousScores[position]!;
		if (score <= NO_SCORE) continue;
		const start = previousStarts[position]!;
		const gaps = previousGaps[position]!;
		const span = position - start + 1;
		const bestSpan = bestEnd - bestStart + 1;
		if (
			score > bestScore ||
			(score === bestScore &&
				(gaps < bestGaps ||
					(gaps === bestGaps && (span < bestSpan || (span === bestSpan && start < bestStart)))))
		) {
			bestScore = score;
			bestStart = start;
			bestEnd = position;
			bestGaps = gaps;
		}
	}

	return bestEnd < 0
		? null
		: {
				gaps: bestGaps,
				inBasename: scheme === "path" && bestStart >= record.basenameStart,
				score: bestScore,
				span: bestEnd - bestStart + 1,
			};
}

function compareRankedIndexes(left: RankedIndex, right: RankedIndex): number {
	return (
		right.score - left.score ||
		right.basenameTerms - left.basenameTerms ||
		left.gaps - right.gaps ||
		left.span - right.span ||
		left.textLength - right.textLength ||
		left.index - right.index
	);
}

export function fuzzyQuickPick<T>(
	items: readonly T[],
	query: string,
	getSearchText: (item: T) => string,
	limit = Number.POSITIVE_INFINITY,
	options: FuzzyQuickPickOptions = {},
): T[] {
	return createFuzzyQuickPick(items, getSearchText, options).search(query, limit);
}

export interface FuzzyQuickPickIndex<T> {
	search(query: string, limit?: number): T[];
}

export function createFuzzyQuickPick<T>(
	items: readonly T[],
	getSearchText: (item: T) => string,
	options: FuzzyQuickPickOptions = {},
): FuzzyQuickPickIndex<T> {
	const haystack = uFuzzy.latinize(items.map(getSearchText));
	const records = haystack.map<SearchRecord>((text) => ({
		basenameStart: Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\")) + 1,
		foldedText: text.toLowerCase(),
		text,
	}));
	const longestText = records.reduce((longest, record) => Math.max(longest, record.text.length), 0);
	const scheme = options.scheme ?? "default";

	return {
		search(query, limit = Number.POSITIVE_INFINITY) {
			const count = cappedLength(items.length, limit);
			if (count === 0) return [];

			const needle = uFuzzy.latinize(query.trim());
			if (!needle) return items.slice(0, count);
			const terms = matcher.split(needle);
			if (terms.length === 0) return items.slice(0, count);

			let filteredIndexes: number[] | undefined;
			for (const term of [...terms].sort((left, right) => right.length - left.length)) {
				const nextIndexes = matcher.filter(haystack, term, filteredIndexes);
				if (nextIndexes === null) return [];
				filteredIndexes = nextIndexes;
			}
			if (!filteredIndexes || filteredIndexes.length === 0) return [];

			const scratch = createScoreScratch(longestText);
			const ranked: RankedIndex[] = [];
			for (const index of filteredIndexes) {
				const record = records[index]!;
				let score = 0;
				let basenameTerms = 0;
				let gaps = 0;
				let span = 0;
				let matched = true;
				for (const term of terms) {
					const termScore = scoreTerm(record, term, scheme, scratch);
					if (!termScore) {
						matched = false;
						break;
					}
					score += termScore.score;
					basenameTerms += termScore.inBasename ? 1 : 0;
					gaps += termScore.gaps;
					span += termScore.span;
				}
				if (matched) {
					ranked.push({
						basenameTerms,
						gaps,
						index,
						score,
						span,
						textLength: record.text.length,
					});
				}
			}

			ranked.sort(compareRankedIndexes);
			return ranked.slice(0, count).map((entry) => items[entry.index]!);
		},
	};
}
