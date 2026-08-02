import { useEffect, useMemo, useRef, useState } from "react";

import {
	createBrowserTerminalPreview,
	type BrowserTerminalPreviewRenderer,
} from "./ghosttyTerminal.ts";
import {
	terminalRendererConfig,
	type TerminalTypographyPreferences,
} from "./typographyPreferences.ts";

interface GhosttyTerminalPreviewProps {
	preferences: TerminalTypographyPreferences;
}

export function GhosttyTerminalPreview({ preferences }: GhosttyTerminalPreviewProps) {
	const config = useMemo(
		() => terminalRendererConfig(preferences),
		[
			preferences.cellHeightAdjustment,
			preferences.cellWidthAdjustment,
			preferences.fontFamily,
			preferences.fontSize,
		],
	);
	const containerRef = useRef<HTMLDivElement>(null);
	const rendererRef = useRef<BrowserTerminalPreviewRenderer | null>(null);
	const latestConfigRef = useRef(config);
	latestConfigRef.current = config;
	const [error, setError] = useState<string | null>(null);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let disposed = false;
		void createBrowserTerminalPreview({ container, config })
			.then((renderer) => {
				if (disposed) {
					renderer.dispose();
					return;
				}
				rendererRef.current = renderer;
				setReady(true);
				return renderer.updateConfig(latestConfigRef.current);
			})
			.catch((previewError) => {
				if (!disposed) {
					setError((previewError as Error).message);
				}
			});
		return () => {
			disposed = true;
			rendererRef.current?.dispose();
			rendererRef.current = null;
		};
	}, []);

	useEffect(() => {
		void rendererRef.current?.updateConfig(config).catch((previewError) => {
			setError((previewError as Error).message);
		});
	}, [config]);

	return (
		<div
			aria-label="Ghostty terminal typography preview"
			className="typography-preview terminal-typography-preview"
			data-renderer="ghostty-web"
			data-testid="terminal-typography-preview"
			role="img"
		>
			<div className="ghostty-terminal-preview" ref={containerRef} />
			{!ready && !error && (
				<span aria-live="polite" className="terminal-preview-status">
					Loading Ghostty preview
				</span>
			)}
			{error && (
				<span className="terminal-preview-status error" role="alert">
					Ghostty preview unavailable: {error}
				</span>
			)}
			<span className="sr-only" data-testid="terminal-column-ruler">
				Terminal column ruler through 80
			</span>
			<span aria-label="lualine preview" className="sr-only">
				NORMAL  settings.lua, utf-8, line 3 column 18
			</span>
			<span aria-label="tmux status preview" className="sr-only">
				0 bun, 1 nvim *, 2 fish
			</span>
		</div>
	);
}
