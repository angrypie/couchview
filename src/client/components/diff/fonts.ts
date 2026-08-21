const DIFF_FONT_FACES = `
@font-face {
	font-family: "Iosevka";
	font-style: normal;
	font-weight: 400;
	font-display: swap;
	src: url(${require("../../assets/fonts/Iosevka-Regular.woff2") as string}) format("woff2");
}
@font-face {
	font-family: "Iosevka";
	font-style: normal;
	font-weight: 700;
	font-display: swap;
	src: url(${require("../../assets/fonts/Iosevka-Bold.woff2") as string}) format("woff2");
}
@font-face {
	font-family: "Iosevka";
	font-style: italic;
	font-weight: 400;
	font-display: swap;
	src: url(${require("../../assets/fonts/Iosevka-Italic.woff2") as string}) format("woff2");
}
@font-face {
	font-family: "Iosevka";
	font-style: italic;
	font-weight: 700;
	font-display: swap;
	src: url(${require("../../assets/fonts/Iosevka-BoldItalic.woff2") as string}) format("woff2");
}
`;

const STYLE_ID = "couchview-diff-font-faces";

export function useDiffFontsLoaded(): boolean {
	if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = DIFF_FONT_FACES;
		document.head.appendChild(style);
	}
	return true;
}

export function diffFontsReady(): boolean {
	return true;
}

export function diffFontFamily(fontStack: string): string {
	return fontStack;
}
