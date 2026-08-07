import { Text } from "./ui";

interface HighlightedMatchProps {
	text: string;
	query: string;
}

export function HighlightedMatch({ text, query }: HighlightedMatchProps) {
	if (!query) return <Text>{text}</Text>;
	const start = text.indexOf(query);
	if (start < 0) return <Text>{text}</Text>;
	return (
		<Text>
			{text.slice(0, start)}
			<Text highlight>{text.slice(start, start + query.length)}</Text>
			{text.slice(start + query.length)}
		</Text>
	);
}
