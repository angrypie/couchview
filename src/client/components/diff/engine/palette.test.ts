import { describe, expect, test } from "bun:test";

import { DIFF_PALETTE, labMix, lineRowColors } from "./palette.ts";

describe("diff palette", () => {
	test("keeps the fixed viewer overrides", () => {
		expect(DIFF_PALETTE.background).toBe("#0d1014");
		expect(DIFF_PALETTE.text).toBe("#e7edf5");
		expect(DIFF_PALETTE.separator).toBe("#17243a");
		expect(DIFF_PALETTE.additionBase).toBe("#52d091");
		expect(DIFF_PALETTE.deletionBase).toBe("#ff7f85");
	});

	test("labMix is deterministic and weights correctly", () => {
		expect(labMix("#000000", "#ffffff", 1)).toBe(labMix("#000000", "#ffffff", 1));
		expect(labMix("#000000", "#000000", 0.5)).toBe("rgb(0, 0, 0)");
		const lighter = labMix("#000000", "#ffffff", 0);
		expect(lighter).toBe("rgb(255, 255, 255)");
		const mid = labMix("#000000", "#ffffff", 0.5);
		const parsed = Number.parseInt(mid.match(/\d+/)?.[0] ?? "", 10);
		expect(parsed).toBeGreaterThan(100);
		expect(parsed).toBeLessThan(140);
	});

	test("mixed line backgrounds are darker than the override colors", () => {
		const addition = lineRowColors("addition");
		expect(addition.background).not.toBe("#112b22");
		expect(addition.numberCell).not.toBe("#52d091");
		expect(addition.numberText).toBe("#52d091");
		const deletion = lineRowColors("deletion");
		expect(deletion.numberText).toBe("#ff7f85");
		const context = lineRowColors("context");
		expect(context.background).toBe("#0d1014");
		expect(context.numberText).toBe("#718096");
	});

	test("keeps the dark row mixes stable and non-white", () => {
		expect(labMix("#0d1014", "#321a1e", 0.8)).toBe("rgb(22, 19, 22)");
		expect(labMix("#0d1014", "#112b22", 0.8)).toBe("rgb(15, 22, 23)");
		expect(labMix("#0d1014", "#52d091", 0.85)).toBe("rgb(26, 41, 37)");
		expect(labMix("#0d1014", "#ff7f85", 0.85)).toBe("rgb(46, 32, 35)");
		const channels = labMix("#0d1014", "#321a1e", 0.8).match(/\d+/g)?.map(Number) ?? [];
		expect(Math.max(...channels)).toBeLessThan(60);
	});
});
