const STYLE_ID = "couchview-diff-viewer-styles";

const DIFF_VIEWER_CSS = `
[data-diff-view] [data-line], [data-diff-view] [data-column-number], [data-diff-view] [data-no-newline] {
	font-variant-ligatures: none;
	font-feature-settings: "liga" 0, "calt" 0;
}
[data-diff-view] [data-no-newline] {
	user-select: none;
}
[data-diff-view][data-line-wrap="true"] [data-line-text] {
	overflow-wrap: break-word;
	word-break: break-word;
}
[data-diff-view] [data-identifier] {
	cursor: pointer;
	border-radius: 2px;
}
[data-diff-view] [data-identifier]:hover {
	background: rgba(125, 166, 255, 0.25);
}
[data-diff-view] [data-identifier]:focus-visible {
	outline: 2px solid #7da6ff;
	outline-offset: -1px;
}
`;

export function injectDiffViewerStyles(): void {
	if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = DIFF_VIEWER_CSS;
	document.head.appendChild(style);
}
