export interface TranscriptInsertion {
	changed: boolean;
	selection: { start: number; end: number };
	value: string;
}

export function insertTranscript(
	value: string,
	selection: { start: number; end: number },
	transcript: string,
	maxLength?: number,
): TranscriptInsertion {
	const start = Math.max(0, Math.min(value.length, selection.start));
	const end = Math.max(start, Math.min(value.length, selection.end));
	const text = transcript.trim();
	if (!text) return { changed: false, selection: { start, end }, value };
	const retainedLength = value.length - (end - start);
	const available = maxLength === undefined ? text.length : Math.max(0, maxLength - retainedLength);
	const insertion = text.slice(0, available);
	if (!insertion) return { changed: false, selection: { start, end }, value };
	const nextValue = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
	const caret = start + insertion.length;
	return {
		changed: nextValue !== value,
		selection: { start: caret, end: caret },
		value: nextValue,
	};
}
