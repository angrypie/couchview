interface HighlightedMatchProps {
	text: string;
	query: string;
}

export function HighlightedMatch({ text, query }: HighlightedMatchProps) {
	if (!query) return text;
	const start = text.indexOf(query);
	if (start < 0) return text;
	return (
		<>
			{text.slice(0, start)}
			<mark className="match">{text.slice(start, start + query.length)}</mark>
			{text.slice(start + query.length)}
		</>
	);
}
