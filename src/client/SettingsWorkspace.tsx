import { ArrowLeft, RotateCcw, Settings2, SquareTerminal, Type } from "lucide-react";
import { useEffect, useState } from "react";

import { GhosttyTerminalPreview } from "./GhosttyTerminalPreview.tsx";

import {
	type CodeFontFamily,
	codeFontStack,
	DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER,
	DEFAULT_TYPOGRAPHY_PREFERENCES,
	type DiffTypographyPreferences,
	type TerminalTypographyPreferences,
	TYPOGRAPHY_LIMITS,
	type TypographyPreferences,
} from "./typographyPreferences.ts";

interface SettingsWorkspaceProps {
	onBack(): void;
	onChange(preferences: TypographyPreferences): void;
	onDirtyChange(dirty: boolean): void;
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
	return (
		left.fontFamily === right.fontFamily &&
		left.fontSize === right.fontSize &&
		left.lineHeightAdjustment === right.lineHeightAdjustment &&
		left.widthAdjustment === right.widthAdjustment
	);
}

function terminalTypographyEqual(
	left: TerminalTypographyPreferences,
	right: TerminalTypographyPreferences,
): boolean {
	return (
		left.fontFamily === right.fontFamily &&
		left.fontSize === right.fontSize &&
		left.cellHeightAdjustment === right.cellHeightAdjustment &&
		left.cellWidthAdjustment === right.cellWidthAdjustment
	);
}

export function SettingsPage({
	onBack,
	onChange,
	onDirtyChange,
	preferences,
}: SettingsWorkspaceProps) {
	const [diffDraft, setDiffDraft] = useState(preferences.diff);
	const [terminalDraft, setTerminalDraft] = useState(preferences.terminal);
	useEffect(() => {
		setDiffDraft(preferences.diff);
	}, [
		preferences.diff.fontFamily,
		preferences.diff.fontSize,
		preferences.diff.lineHeightAdjustment,
		preferences.diff.widthAdjustment,
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
	useEffect(() => {
		onDirtyChange(diffDirty || terminalDirty);
	}, [diffDirty, onDirtyChange, terminalDirty]);
	useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
	const updateDiff = (patch: Partial<DiffTypographyPreferences>) => {
		setDiffDraft((current) => ({ ...current, ...patch }));
	};
	const updateTerminal = (patch: Partial<TerminalTypographyPreferences>) => {
		setTerminalDraft((current) => ({ ...current, ...patch }));
	};
	const applyDiff = () => onChange({ ...preferences, diff: diffDraft });
	const applyTerminal = () => onChange({ ...preferences, terminal: terminalDraft });
	const diffLineHeight = Math.max(
		4,
		diffDraft.fontSize * DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER + diffDraft.lineHeightAdjustment,
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
						These settings belong to this browser. Couchview no longer reads your host Ghostty
						appearance configuration.
					</p>
				</div>

				<div className="settings-grid">
					<section className="settings-card" aria-labelledby="diff-settings-title">
						<header className="settings-card-header">
							<div className="settings-card-heading">
								<span className="settings-card-icon">
									<Type size={18} />
								</span>
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
							description="Adds pixels to or removes pixels from the original diff row height."
							format={signedPixels}
							id="diff-line-height-adjustment"
							label="Line height adjustment"
							onChange={(lineHeightAdjustment) => updateDiff({ lineHeightAdjustment })}
							value={diffDraft.lineHeightAdjustment}
							{...TYPOGRAPHY_LIMITS.diff.lineHeightAdjustment}
						/>
						<TypographySlider
							description="Adds pixels to or removes pixels from the original character width."
							format={signedPixels}
							id="diff-width-adjustment"
							label="Width adjustment"
							onChange={(widthAdjustment) => updateDiff({ widthAdjustment })}
							value={diffDraft.widthAdjustment}
							{...TYPOGRAPHY_LIMITS.diff.widthAdjustment}
						/>

						<div
							className="typography-preview diff-typography-preview"
							data-testid="diff-typography-preview"
							style={{
								fontFamily: codeFontStack(diffDraft.fontFamily),
								fontSize: `${diffDraft.fontSize}px`,
								letterSpacing: `${diffDraft.widthAdjustment}px`,
								lineHeight: `${diffLineHeight}px`,
							}}
						>
							<ColumnRuler testId="diff-column-ruler" />
							<div className="diff-preview-lines">
								<span>
									<i>12</i>
									<b>−</b> const spacing = hostConfig;
								</span>
								<span>
									<i>12</i>
									<b>+</b> const spacing = browserSettings;
								</span>
								<span>
									<i>13</i>
									<b> </b> return reliableTypography;
								</span>
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
								<span className="settings-card-icon">
									<SquareTerminal size={18} />
								</span>
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

						<GhosttyTerminalPreview preferences={terminalDraft} />
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
