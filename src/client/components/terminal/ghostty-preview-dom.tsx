"use dom";

import { useEffect, useMemo, useRef, useState } from "react";

import {
	type BrowserTerminalPreviewRenderer,
	createBrowserTerminalPreview,
} from "../../ghosttyTerminal.ts";
import { terminalRendererConfig } from "../../typographyPreferences.ts";
import type { GhosttyPreviewDomProps } from "./ghostty-preview-contract.ts";

const previewStyles = `
	* { box-sizing: border-box; }
	html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
	body { background: transparent; }
	.preview { position: relative; width: 100%; height: 100%; overflow: hidden; }
	.surface { width: 100%; height: 100%; overflow: hidden; pointer-events: none; user-select: none; }
	.surface canvas { max-width: none; }
	.status {
		position: absolute; inset: 0; display: grid; place-items: center; padding: 16px;
		color: #8f9baa; background: rgb(13 16 20 / 72%); font: 13px system-ui, sans-serif;
		text-align: center;
	}
	.status.error { color: #ff7f85; }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
`;

export default function GhosttyPreviewDom({ preferences, themeType }: GhosttyPreviewDomProps) {
	const config = useMemo(
		() => terminalRendererConfig(preferences, themeType),
		[
			preferences.cellHeightAdjustment,
			preferences.cellWidthAdjustment,
			preferences.fontFamily,
			preferences.fontSize,
			themeType,
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
				if (!disposed) setError((previewError as Error).message);
			});
		return () => {
			disposed = true;
			rendererRef.current?.dispose();
			rendererRef.current = null;
		};
	}, [config]);

	useEffect(() => {
		void rendererRef.current?.updateConfig(config).catch((previewError) => {
			setError((previewError as Error).message);
		});
	}, [config]);

	return (
		<>
			<style>{previewStyles}</style>
			<div
				aria-label="Ghostty terminal typography preview"
				className="preview"
				data-renderer="ghostty-web"
				data-testid="terminal-typography-preview"
				role="img"
			>
				<div className="surface" ref={containerRef} />
				{!ready && !error ? (
					<span aria-live="polite" className="status">
						Loading Ghostty preview
					</span>
				) : null}
				{error ? (
					<span className="status error" role="alert">
						Ghostty preview unavailable: {error}
					</span>
				) : null}
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
		</>
	);
}
