export const TYPOGRAPHY_STORAGE_KEY = "couchview:typography:v1";

export type CodeFontFamily = "iosevka" | "system";

export interface DiffTypographyPreferences {
  fontFamily: CodeFontFamily;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

export interface TerminalTypographyPreferences {
  fontFamily: CodeFontFamily;
  fontSize: number;
  cellHeightAdjustment: number;
  cellWidthAdjustment: number;
}

export interface TypographyPreferences {
  diff: DiffTypographyPreferences;
  terminal: TerminalTypographyPreferences;
}

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

interface NumericLimit {
  min: number;
  max: number;
  step: number;
}

export const TYPOGRAPHY_LIMITS = {
  diff: {
    fontSize: { min: 9, max: 24, step: 1 },
    lineHeight: { min: 1.1, max: 2, step: 0.05 },
    letterSpacing: { min: -1, max: 2, step: 0.1 },
  },
  terminal: {
    fontSize: { min: 8, max: 32, step: 1 },
    cellHeightAdjustment: { min: -4, max: 16, step: 1 },
    cellWidthAdjustment: { min: -5, max: 5, step: 1 },
  },
} as const;

export const DEFAULT_TYPOGRAPHY_PREFERENCES: TypographyPreferences = {
  diff: {
    fontFamily: "iosevka",
    fontSize: 11,
    lineHeight: 1.55,
    letterSpacing: 0,
  },
  terminal: {
    fontFamily: "iosevka",
    fontSize: 15,
    cellHeightAdjustment: 1,
    cellWidthAdjustment: -1,
  },
};

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

function boundedNumber(
  value: unknown,
  fallback: number,
  limit: NumericLimit,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(limit.max, Math.max(limit.min, value));
  const stepped = Math.round(clamped / limit.step) * limit.step;
  return Number(stepped.toFixed(limit.step < 1 ? 2 : 0));
}

function fontFamily(value: unknown, fallback: CodeFontFamily): CodeFontFamily {
  return value === "iosevka" || value === "system" ? value : fallback;
}

export function normalizeTypographyPreferences(value: unknown): TypographyPreferences {
  const candidate = value && typeof value === "object"
    ? value as Partial<TypographyPreferences>
    : {};
  const diff: Partial<DiffTypographyPreferences> =
    candidate.diff && typeof candidate.diff === "object" ? candidate.diff : {};
  const terminal: Partial<TerminalTypographyPreferences> =
    candidate.terminal && typeof candidate.terminal === "object"
    ? candidate.terminal
    : {};
  const defaults = DEFAULT_TYPOGRAPHY_PREFERENCES;
  return {
    diff: {
      fontFamily: fontFamily(diff.fontFamily, defaults.diff.fontFamily),
      fontSize: boundedNumber(
        diff.fontSize,
        defaults.diff.fontSize,
        TYPOGRAPHY_LIMITS.diff.fontSize,
      ),
      lineHeight: boundedNumber(
        diff.lineHeight,
        defaults.diff.lineHeight,
        TYPOGRAPHY_LIMITS.diff.lineHeight,
      ),
      letterSpacing: boundedNumber(
        diff.letterSpacing,
        defaults.diff.letterSpacing,
        TYPOGRAPHY_LIMITS.diff.letterSpacing,
      ),
    },
    terminal: {
      fontFamily: fontFamily(terminal.fontFamily, defaults.terminal.fontFamily),
      fontSize: boundedNumber(
        terminal.fontSize,
        defaults.terminal.fontSize,
        TYPOGRAPHY_LIMITS.terminal.fontSize,
      ),
      cellHeightAdjustment: boundedNumber(
        terminal.cellHeightAdjustment,
        defaults.terminal.cellHeightAdjustment,
        TYPOGRAPHY_LIMITS.terminal.cellHeightAdjustment,
      ),
      cellWidthAdjustment: boundedNumber(
        terminal.cellWidthAdjustment,
        defaults.terminal.cellWidthAdjustment,
        TYPOGRAPHY_LIMITS.terminal.cellWidthAdjustment,
      ),
    },
  };
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
