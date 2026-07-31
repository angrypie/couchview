import {
  DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  normalizeTypographyPreferences,
  TYPOGRAPHY_LIMITS,
  type CodeFontFamily,
  type TerminalTypographyPreferences,
  type TypographyPreferences,
} from "../shared/settings.ts";

export {
  DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  normalizeTypographyPreferences,
  TYPOGRAPHY_LIMITS,
};
export type {
  CodeFontFamily,
  DiffTypographyPreferences,
  TerminalTypographyPreferences,
  TypographyPreferences,
} from "../shared/settings.ts";

export const TYPOGRAPHY_STORAGE_KEY = "couchview:typography:v1";

export interface TerminalRendererTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  selectionForeground: string;
  palette: readonly string[];
}

export interface TerminalRendererConfig extends TerminalTypographyPreferences {
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  theme: TerminalRendererTheme;
}

const TERMINAL_THEME: TerminalRendererTheme = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#ced5f1",
  selectionBackground: "#353749",
  selectionForeground: "#cdd6f4",
  palette: [
    "#45475a",
    "#f38ba8",
    "#a6e3a1",
    "#f9e2af",
    "#89b4fa",
    "#f5c2e7",
    "#94e2d5",
    "#bac2de",
    "#585b70",
    "#f38ba8",
    "#a6e3a1",
    "#f9e2af",
    "#89b4fa",
    "#f5c2e7",
    "#94e2d5",
    "#a6adc8",
  ],
};

export const CODE_FONT_STACKS: Record<CodeFontFamily, string> = {
  iosevka: '"Iosevka", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  system: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};

export function codeFontStack(fontFamily: CodeFontFamily): string {
  return CODE_FONT_STACKS[fontFamily];
}

export function loadTypographyPreferences(
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): TypographyPreferences {
  try {
    const stored = storage.getItem(TYPOGRAPHY_STORAGE_KEY);
    if (stored) return normalizeTypographyPreferences(JSON.parse(stored));

    const legacySize = Number(
      storage.getItem("couchview:font-size") ??
        storage.getItem("couch-review:font-size") ??
        Number.NaN,
    );
    if (Number.isFinite(legacySize)) {
      const migrated = normalizeTypographyPreferences({
        ...DEFAULT_TYPOGRAPHY_PREFERENCES,
        diff: {
          ...DEFAULT_TYPOGRAPHY_PREFERENCES.diff,
          fontSize: legacySize,
        },
      });
      storage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // Browser defaults remain usable when persistent storage is unavailable.
  }
  return DEFAULT_TYPOGRAPHY_PREFERENCES;
}

export function saveTypographyPreferences(
  preferences: TypographyPreferences,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): TypographyPreferences {
  const normalized = normalizeTypographyPreferences(preferences);
  try {
    storage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Live settings remain usable when persistent storage is unavailable.
  }
  return normalized;
}

export function terminalRendererConfig(
  preferences: TerminalTypographyPreferences,
): TerminalRendererConfig {
  const normalized = normalizeTypographyPreferences({ terminal: preferences }).terminal;
  return {
    ...normalized,
    cursorStyle: "block",
    cursorBlink: false,
    theme: TERMINAL_THEME,
  };
}

export const SAFE_TERMINAL_RENDERER_CONFIG = terminalRendererConfig(
  DEFAULT_TYPOGRAPHY_PREFERENCES.terminal,
);
