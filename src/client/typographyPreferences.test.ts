import { describe, expect, test } from "bun:test";

import {
	codeFontStack,
	DEFAULT_TYPOGRAPHY_PREFERENCES,
	normalizeTypographyPreferences,
	terminalRendererConfig,
} from "./typographyPreferences.ts";

describe("browser typography preferences", () => {
	test("uses zero height and width adjustments by default", () => {
		expect(DEFAULT_TYPOGRAPHY_PREFERENCES.diff).toMatchObject({
			lineHeightAdjustment: 0,
			widthAdjustment: 0,
		});
		expect(DEFAULT_TYPOGRAPHY_PREFERENCES.terminal).toMatchObject({
			cellHeightAdjustment: 0,
			cellWidthAdjustment: 0,
		});
	});

	test("normalizes independently bounded diff and terminal settings", () => {
		expect(
			normalizeTypographyPreferences({
				diff: {
					fontFamily: "comic-sans",
					fontSize: 200,
					lineHeightAdjustment: -20,
					widthAdjustment: 0.36,
				},
				terminal: {
					fontFamily: "system",
					fontSize: 4,
					cellHeightAdjustment: 100,
					cellWidthAdjustment: -20,
				},
			}),
		).toEqual({
			diff: {
				fontFamily: "iosevka",
				fontSize: 24,
				lineHeightAdjustment: -5,
				widthAdjustment: 0.4,
			},
			terminal: {
				fontFamily: "system",
				fontSize: 8,
				cellHeightAdjustment: 16,
				cellWidthAdjustment: -5,
			},
		});
	});

	test("uses a true system monospace stack and creates a client-only terminal config", () => {
		expect(codeFontStack("system")).toStartWith("ui-monospace");
		expect(codeFontStack("system")).not.toContain("Iosevka");
		expect(
			terminalRendererConfig({
				fontFamily: "system",
				fontSize: 18,
				cellHeightAdjustment: 4,
				cellWidthAdjustment: 2,
			}),
		).toMatchObject({
			fontFamily: "system",
			fontSize: 18,
			cellHeightAdjustment: 4,
			cellWidthAdjustment: 2,
			cursorStyle: "block",
			cursorBlink: false,
			theme: { background: "#1e1e2e" },
		});
	});

	test("clamps terminal cell width symmetrically from minus five to plus five", () => {
		expect(
			normalizeTypographyPreferences({
				terminal: {
					...DEFAULT_TYPOGRAPHY_PREFERENCES.terminal,
					cellWidthAdjustment: 20,
				},
			}).terminal.cellWidthAdjustment,
		).toBe(5);
		expect(
			normalizeTypographyPreferences({
				terminal: {
					...DEFAULT_TYPOGRAPHY_PREFERENCES.terminal,
					cellWidthAdjustment: -20,
				},
			}).terminal.cellWidthAdjustment,
		).toBe(-5);
	});

	test("provides a readable light terminal palette", () => {
		const config = terminalRendererConfig(DEFAULT_TYPOGRAPHY_PREFERENCES.terminal, "light");

		expect(config.theme).toMatchObject({
			background: "#fbfcfe",
			foreground: "#233044",
			selectionBackground: "#c9d9fa",
		});
		expect(config.theme.palette).toHaveLength(16);
	});
});
