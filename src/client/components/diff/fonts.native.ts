import { useFonts } from "expo-font";
import { Platform } from "react-native";

const DIFF_FONTS = {
	Iosevka: require("../../assets/fonts/ttf/Iosevka-Regular.ttf"),
	"Iosevka-Bold": require("../../assets/fonts/ttf/Iosevka-Bold.ttf"),
};

let fontsLoaded = false;

export function useDiffFontsLoaded(): boolean {
	const [loaded] = useFonts(DIFF_FONTS);
	fontsLoaded = loaded;
	return loaded;
}

export function diffFontsReady(): boolean {
	return fontsLoaded;
}

const NATIVE_MONO_FALLBACK = Platform.OS === "ios" ? "Menlo" : "monospace";

/**
 * The diff renderer receives a CSS font stack; React Native needs a single
 * family name. The first family wins when it is the bundled Iosevka face,
 * otherwise a platform monospace is used.
 */
export function diffFontFamily(fontStack: string): string {
	const first = fontStack.split(",")[0]?.trim().replace(/^"|"$/g, "") ?? "";
	return first === "Iosevka" ? "Iosevka" : NATIVE_MONO_FALLBACK;
}
