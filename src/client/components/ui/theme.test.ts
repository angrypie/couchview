import { describe, expect, test } from "bun:test";

function readVariantVariables(css: string, variant: "dark" | "light") {
	const match = new RegExp(`@variant ${variant} \\{([\\s\\S]*?)\\n\\t\\t\\}`).exec(css);
	if (!match?.[1]) throw new Error(`Missing ${variant} theme variant`);

	return [...match[1].matchAll(/--([a-z0-9-]+)\s*:/g)].map((entry) => entry[1]).sort();
}

describe("universal UI theme", () => {
	test("defines the same semantic tokens for light and dark themes", async () => {
		const css = await Bun.file(new URL("./theme.css", import.meta.url)).text();
		const lightVariables = readVariantVariables(css, "light");
		const darkVariables = readVariantVariables(css, "dark");

		expect(darkVariables).toEqual(lightVariables);
		expect(lightVariables).toContain("ui-background");
		expect(lightVariables).toContain("ui-foreground");
		expect(lightVariables).toContain("ui-primary");
		expect(lightVariables).toContain("ui-scrim");
	});

	test("uses components/ui as the native theme source", async () => {
		const nativeCss = await Bun.file(new URL("../../../../native.css", import.meta.url)).text();

		expect(nativeCss).toContain('@import "./src/client/components/ui/theme.css";');
		expect(nativeCss).not.toContain("src/client/styles");
	});

	test("keeps Expo UI variants behind the design-system boundary", async () => {
		const componentRoot = new URL("../", import.meta.url);
		const expoUiImport = ["@expo", "ui"].join("/");
		const imports: string[] = [];
		for await (const path of new Bun.Glob("**/*.{ts,tsx}").scan({
			cwd: componentRoot.pathname,
		})) {
			const source = await Bun.file(new URL(path, componentRoot)).text();
			if (source.includes(`from "${expoUiImport}"`)) imports.push(path);
		}

		expect(imports).toEqual(["ui/native-control/index.tsx"]);
	});
});
