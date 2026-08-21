const VIEWER_BACKGROUND = "#0d1014";
const VIEWER_TEXT = "#e7edf5";
const VIEWER_SEPARATOR = "#17243a";
const VIEWER_ADDITION = "#112b22";
const VIEWER_DELETION = "#321a1e";
const VIEWER_NUMBER = "#718096";
const VIEWER_GREEN = "#52d091";
const VIEWER_RED = "#ff7f85";
const VIEWER_ACCENT = "#7da6ff";

const DARK_MIXER = "#ffffff";

export interface DiffPalette {
	background: string;
	text: string;
	contextLine: string;
	separator: string;
	separatorText: string;
	numberText: string;
	additionLine: string;
	deletionLine: string;
	additionNumberCell: string;
	deletionNumberCell: string;
	additionNumberText: string;
	deletionNumberText: string;
	additionBase: string;
	deletionBase: string;
	modifiedBase: string;
	additionEmphasis: string;
	deletionEmphasis: string;
	gutterBorder: string;
	hoveredLineMixer: string;
}

function clamp(value: number): number {
	return Math.min(255, Math.max(0, value));
}

function hexToRgb(hex: string): [number, number, number] {
	const value = Number.parseInt(hex.slice(1), 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function srgbToLinear(channel: number): number {
	const value = channel / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
	const channel = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
	return clamp(Math.round(channel * 255));
}

function rgbToLab(hex: string): [number, number, number] {
	const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as [number, number, number];
	const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
	const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
	const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
	const f = (value: number): number =>
		value > 216 / 24389 ? Math.cbrt(value) : (841 / 108) * value + 4 / 29;
	const fx = f(x);
	const fy = f(y);
	const fz = f(z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(lab: [number, number, number]): string {
	const [l, a, b] = lab;
	const fy = (l + 16) / 116;
	const fx = fy + a / 500;
	const fz = fy - b / 200;
	const invert = (value: number): number =>
		value > 6 / 29 ? value ** 3 : (108 / 841) * (value - 4 / 29);
	const x = invert(fx) * 0.95047;
	const y = invert(fy);
	const z = invert(fz) * 1.08883;
	const r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
	const g = x * -0.969266 + y * 1.8760108 + z * 0.041556;
	const bCh = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
	return `rgb(${linearToSrgb(r)}, ${linearToSrgb(g)}, ${linearToSrgb(bCh)})`;
}

/**
 * Mix two hex colors in CIELAB, matching the CSS `color-mix(in lab, a p1, b p2)`
 * semantics the Pierre stylesheet uses for diff line backgrounds.
 */
export function labMix(first: string, second: string, firstWeight: number): string {
	const a = rgbToLab(first);
	const b = rgbToLab(second);
	const weight = Math.min(1, Math.max(0, firstWeight));
	const mixed: [number, number, number] = [
		a[0] * weight + b[0] * (1 - weight),
		a[1] * weight + b[1] * (1 - weight),
		a[2] * weight + b[2] * (1 - weight),
	];
	return labToRgb(mixed);
}

function rgba(hex: string, alpha: number): string {
	const [r, g, b] = hexToRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const DIFF_PALETTE: DiffPalette = {
	background: VIEWER_BACKGROUND,
	text: VIEWER_TEXT,
	contextLine: VIEWER_BACKGROUND,
	separator: VIEWER_SEPARATOR,
	separatorText: VIEWER_NUMBER,
	numberText: VIEWER_NUMBER,
	additionLine: labMix(VIEWER_BACKGROUND, VIEWER_ADDITION, 0.8),
	deletionLine: labMix(VIEWER_BACKGROUND, VIEWER_DELETION, 0.8),
	additionNumberCell: labMix(VIEWER_BACKGROUND, VIEWER_GREEN, 0.85),
	deletionNumberCell: labMix(VIEWER_BACKGROUND, VIEWER_RED, 0.85),
	additionNumberText: VIEWER_GREEN,
	deletionNumberText: VIEWER_RED,
	additionBase: VIEWER_GREEN,
	deletionBase: VIEWER_RED,
	modifiedBase: VIEWER_ACCENT,
	additionEmphasis: rgba(VIEWER_GREEN, 0.2),
	deletionEmphasis: rgba(VIEWER_RED, 0.2),
	gutterBorder: VIEWER_BACKGROUND,
	hoveredLineMixer: DARK_MIXER,
};

export function lineRowColors(kind: "context" | "addition" | "deletion"): {
	background: string;
	numberCell: string;
	numberText: string;
} {
	if (kind === "addition") {
		return {
			background: DIFF_PALETTE.additionLine,
			numberCell: DIFF_PALETTE.additionNumberCell,
			numberText: DIFF_PALETTE.additionNumberText,
		};
	}
	if (kind === "deletion") {
		return {
			background: DIFF_PALETTE.deletionLine,
			numberCell: DIFF_PALETTE.deletionNumberCell,
			numberText: DIFF_PALETTE.deletionNumberText,
		};
	}
	return {
		background: VIEWER_BACKGROUND,
		numberCell: VIEWER_BACKGROUND,
		numberText: VIEWER_NUMBER,
	};
}

export function themeForeground(themeType: "dark" | "light"): string {
	return themeType === "dark" ? "#fafafa" : "#0a0a0a";
}
