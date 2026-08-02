import { useEffect, useState } from "react";

export const SPLIT_VIEW_QUERY = [
	"(orientation: landscape) and (min-width: 760px) and (min-height: 600px)",
	"(min-width: 1100px) and (min-height: 600px)",
].join(", ");

export const COMPACT_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 599px)";

export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() =>
		typeof window === "undefined" ? false : window.matchMedia(query).matches,
	);

	useEffect(() => {
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, [query]);

	return matches;
}
