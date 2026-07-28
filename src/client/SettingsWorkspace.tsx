import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import {
  ArrowLeft,
  RotateCcw,
  Settings2,
  SquareTerminal,
  Type,
} from "lucide-react";

import {
  codeFontStack,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  TYPOGRAPHY_LIMITS,
  type CodeFontFamily,
  type DiffTypographyPreferences,
  type TerminalTypographyPreferences,
  type TypographyPreferences,
} from "./typographyPreferences.ts";

interface SettingsWorkspaceProps {
  onBack(): void;
  onChange(preferences: TypographyPreferences): void;
  preferences: TypographyPreferences;
}

const COLUMN_RULER = (() => {
  const columns = Array.from({ length: 80 }, () => "·");
  for (let marker = 10; marker <= columns.length; marker += 10) {
    const label = String(marker);
    const start = marker - label.length;
    for (let index = 0; index < label.length; index += 1) {
      columns[start + index] = label[index]!;
    }
  }
  return columns.join("");
})();

function ColumnRuler({ testId }: { testId: string }) {
  return (
    <div
      aria-label="Column ruler from 1 to 80"
      className="typography-column-ruler"
      data-testid={testId}
      title="The last visible number shows approximately how many columns fit."
    >
      {COLUMN_RULER}
    </div>
  );
}

function PowerlineSegment({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <span className={`powerline-segment ${className}`}>
      <span className="powerline-copy">{children}</span>
      <span aria-hidden="true" className="powerline-symbol"></span>
    </span>
  );
}

interface FontFamilyPickerProps {
  label: string;
  onChange(fontFamily: CodeFontFamily): void;
  value: CodeFontFamily;
}

function FontFamilyPicker({ label, onChange, value }: FontFamilyPickerProps) {
  return (
    <fieldset className="settings-fieldset">
      <legend>{label}</legend>
      <div className="font-family-picker">
        <button
          aria-pressed={value === "iosevka"}
          className={value === "iosevka" ? "active" : ""}
          onClick={() => onChange("iosevka")}
          type="button"
        >
          <strong>Iosevka</strong>
          <span>Bundled and identical on every device</span>
        </button>
        <button
          aria-pressed={value === "system"}
          className={value === "system" ? "active" : ""}
          onClick={() => onChange("system")}
          type="button"
        >
          <strong>System monospace</strong>
          <span>Uses ui-monospace from this browser and OS</span>
        </button>
      </div>
    </fieldset>
  );
}

interface TypographySliderProps {
  description: string;
  format(value: number): string;
  id: string;
  label: string;
  max: number;
  min: number;
  onChange(value: number): void;
  step: number;
  value: number;
}

function TypographySlider({
  description,
  format,
  id,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: TypographySliderProps) {
  return (
    <div className="settings-control">
      <div className="settings-control-heading">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        aria-describedby={`${id}-description`}
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
      <p id={`${id}-description`}>{description}</p>
    </div>
  );
}

function signedPixels(value: number): string {
  return `${value > 0 ? "+" : ""}${value}px`;
}

function diffTypographyEqual(
  left: DiffTypographyPreferences,
  right: DiffTypographyPreferences,
): boolean {
  return left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight &&
    left.letterSpacing === right.letterSpacing;
}

function terminalTypographyEqual(
  left: TerminalTypographyPreferences,
  right: TerminalTypographyPreferences,
): boolean {
  return left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.cellHeightAdjustment === right.cellHeightAdjustment &&
    left.cellWidthAdjustment === right.cellWidthAdjustment;
}

export function SettingsPage({
  onBack,
  onChange,
  preferences,
}: SettingsWorkspaceProps) {
  const [diffDraft, setDiffDraft] = useState(preferences.diff);
  const [terminalDraft, setTerminalDraft] = useState(preferences.terminal);
  useEffect(() => {
    setDiffDraft(preferences.diff);
  }, [
    preferences.diff.fontFamily,
    preferences.diff.fontSize,
    preferences.diff.letterSpacing,
    preferences.diff.lineHeight,
  ]);
  useEffect(() => {
    setTerminalDraft(preferences.terminal);
  }, [
    preferences.terminal.cellHeightAdjustment,
    preferences.terminal.cellWidthAdjustment,
    preferences.terminal.fontFamily,
    preferences.terminal.fontSize,
  ]);
  const diffDirty = !diffTypographyEqual(diffDraft, preferences.diff);
  const terminalDirty = !terminalTypographyEqual(terminalDraft, preferences.terminal);
  const updateDiff = (patch: Partial<DiffTypographyPreferences>) => {
    setDiffDraft((current) => ({ ...current, ...patch }));
  };
  const updateTerminal = (patch: Partial<TerminalTypographyPreferences>) => {
    setTerminalDraft((current) => ({ ...current, ...patch }));
  };
  const applyDiff = () => onChange({ ...preferences, diff: diffDraft });
  const applyTerminal = () => onChange({ ...preferences, terminal: terminalDraft });
  const diffLineHeight = diffDraft.fontSize * diffDraft.lineHeight;
  const terminalLineHeight = Math.max(
    4,
    terminalDraft.fontSize + terminalDraft.cellHeightAdjustment,
  );

  return (
    <section aria-label="Settings" className="settings-workspace">
      <header className="settings-toolbar">
        <button className="terminal-toolbar-button" onClick={onBack} type="button">
          <ArrowLeft size={16} /> Review
        </button>
        <div className="settings-heading">
          <Settings2 size={16} />
          <span>Settings</span>
        </div>
        <button
          className="terminal-toolbar-button"
          onClick={() => onChange(DEFAULT_TYPOGRAPHY_PREFERENCES)}
          type="button"
        >
          <RotateCcw size={15} /> Reset all
        </button>
      </header>

      <div className="settings-scroll">
        <div className="settings-intro">
          <h1>Typography</h1>
          <p>
            These settings belong to this browser. Couchview no longer reads your host
            Ghostty appearance configuration.
          </p>
        </div>

        <div className="settings-grid">
          <section className="settings-card" aria-labelledby="diff-settings-title">
            <header className="settings-card-header">
              <div className="settings-card-heading">
                <span className="settings-card-icon"><Type size={18} /></span>
                <div>
                  <h2 id="diff-settings-title">Diff view</h2>
                  <p>Code review typography, independent from the terminal.</p>
                </div>
              </div>
              <button
                aria-label="Apply diff changes"
                className="action-button settings-apply-button"
                disabled={!diffDirty}
                onClick={applyDiff}
                type="button"
              >
                Apply
              </button>
            </header>
            <p aria-live="polite" className="settings-card-status">
              {diffDirty
                ? "Previewing unapplied changes. The review is unchanged."
                : "Diff settings are applied."}
            </p>

            <FontFamilyPicker
              label="Diff font family"
              onChange={(fontFamily) => updateDiff({ fontFamily })}
              value={diffDraft.fontFamily}
            />
            <TypographySlider
              description="Changes glyph size without changing terminal text."
              format={(value) => `${value}px`}
              id="diff-font-size"
              label="Font size"
              onChange={(fontSize) => updateDiff({ fontSize })}
              value={diffDraft.fontSize}
              {...TYPOGRAPHY_LIMITS.diff.fontSize}
            />
            <TypographySlider
              description="Controls the vertical distance from one code row to the next."
              format={(value) => `${value.toFixed(2)}×`}
              id="diff-line-height"
              label="Line height"
              onChange={(lineHeight) => updateDiff({ lineHeight })}
              value={diffDraft.lineHeight}
              {...TYPOGRAPHY_LIMITS.diff.lineHeight}
            />
            <TypographySlider
              description="Adds or removes horizontal space between characters."
              format={signedPixels}
              id="diff-letter-spacing"
              label="Letter spacing"
              onChange={(letterSpacing) => updateDiff({ letterSpacing })}
              value={diffDraft.letterSpacing}
              {...TYPOGRAPHY_LIMITS.diff.letterSpacing}
            />

            <div
              className="typography-preview diff-typography-preview"
              data-testid="diff-typography-preview"
              style={{
                fontFamily: codeFontStack(diffDraft.fontFamily),
                fontSize: `${diffDraft.fontSize}px`,
                letterSpacing: `${diffDraft.letterSpacing}px`,
                lineHeight: `${diffLineHeight}px`,
              }}
            >
              <ColumnRuler testId="diff-column-ruler" />
              <div className="diff-preview-lines">
                <span><i>12</i><b>−</b> const spacing = hostConfig;</span>
                <span><i>12</i><b>+</b> const spacing = browserSettings;</span>
                <span><i>13</i><b> </b> return reliableTypography;</span>
              </div>
            </div>
            <button
              className="text-button settings-reset"
              onClick={() => setDiffDraft(DEFAULT_TYPOGRAPHY_PREFERENCES.diff)}
              type="button"
            >
              Reset diff typography
            </button>
          </section>

          <section className="settings-card" aria-labelledby="terminal-settings-title">
            <header className="settings-card-header">
              <div className="settings-card-heading">
                <span className="settings-card-icon"><SquareTerminal size={18} /></span>
                <div>
                  <h2 id="terminal-settings-title">Terminal</h2>
                  <p>Ghostty-web grid metrics, independent from the diff.</p>
                </div>
              </div>
              <button
                aria-label="Apply terminal changes"
                className="action-button settings-apply-button"
                disabled={!terminalDirty}
                onClick={applyTerminal}
                type="button"
              >
                Apply
              </button>
            </header>
            <p aria-live="polite" className="settings-card-status">
              {terminalDirty
                ? "Previewing unapplied changes. The running terminal is unchanged."
                : "Terminal settings are applied."}
            </p>

            <FontFamilyPicker
              label="Terminal font family"
              onChange={(fontFamily) => updateTerminal({ fontFamily })}
              value={terminalDraft.fontFamily}
            />
            <TypographySlider
              description="Sets terminal glyph size. Cmd/Ctrl + and − remain temporary shortcuts."
              format={(value) => `${value}px`}
              id="terminal-font-size"
              label="Font size"
              onChange={(fontSize) => updateTerminal({ fontSize })}
              value={terminalDraft.fontSize}
              {...TYPOGRAPHY_LIMITS.terminal.fontSize}
            />
            <TypographySlider
              description="Terminal line height: adds pixels to every measured grid row."
              format={signedPixels}
              id="terminal-cell-height"
              label="Cell height adjustment"
              onChange={(cellHeightAdjustment) => updateTerminal({ cellHeightAdjustment })}
              value={terminalDraft.cellHeightAdjustment}
              {...TYPOGRAPHY_LIMITS.terminal.cellHeightAdjustment}
            />
            <TypographySlider
              description="Terminal character spacing: adds pixels to every measured grid column."
              format={signedPixels}
              id="terminal-cell-width"
              label="Cell width adjustment"
              onChange={(cellWidthAdjustment) => updateTerminal({ cellWidthAdjustment })}
              value={terminalDraft.cellWidthAdjustment}
              {...TYPOGRAPHY_LIMITS.terminal.cellWidthAdjustment}
            />

            <div
              className="typography-preview terminal-typography-preview"
              data-testid="terminal-typography-preview"
              style={{
                "--preview-terminal-background": "#1e1e2e",
                fontFamily: codeFontStack(terminalDraft.fontFamily),
                fontSize: `${terminalDraft.fontSize}px`,
                letterSpacing: `${terminalDraft.cellWidthAdjustment}px`,
                lineHeight: `${terminalLineHeight}px`,
              } as CSSProperties}
            >
              <ColumnRuler testId="terminal-column-ruler" />
              <div className="terminal-preview-command"><b>❯</b> nvim ~/.config/nvim/init.lua</div>
              <div aria-label="lualine preview" className="preview-lualine">
                <div className="powerline-group">
                  <PowerlineSegment className="powerline-mode">NORMAL</PowerlineSegment>
                  <PowerlineSegment className="powerline-file">settings.lua</PowerlineSegment>
                </div>
                <span className="lualine-location">utf-8&nbsp; 3:18</span>
              </div>
              <div aria-label="tmux status preview" className="preview-tmuxline">
                <PowerlineSegment className="tmux-index">0</PowerlineSegment>
                <PowerlineSegment className="tmux-window">bun</PowerlineSegment>
                <PowerlineSegment className="tmux-index">1</PowerlineSegment>
                <PowerlineSegment className="tmux-window active">nvim *</PowerlineSegment>
                <PowerlineSegment className="tmux-index">2</PowerlineSegment>
                <PowerlineSegment className="tmux-window">fish -</PowerlineSegment>
              </div>
            </div>
            <button
              className="text-button settings-reset"
              onClick={() => setTerminalDraft(DEFAULT_TYPOGRAPHY_PREFERENCES.terminal)}
              type="button"
            >
              Reset terminal typography
            </button>
          </section>
        </div>
      </div>
    </section>
  );
}
