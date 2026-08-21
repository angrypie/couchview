import { useEffect } from "react";

interface UseOverlayAccessibilityOptions {
	dismissTop: () => void;
	paletteOpen: boolean;
	visible: boolean;
}

export function useOverlayAccessibility({
	dismissTop,
	paletteOpen,
	visible,
}: UseOverlayAccessibilityOptions) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (paletteOpen || event.key !== "Escape" || !visible) return;
			event.preventDefault();
			dismissTop();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [dismissTop, paletteOpen, visible]);

	useEffect(() => {
		if (!visible) return;
		const previousFocus = document.activeElement as HTMLElement | null;
		const overlays = document.querySelectorAll<HTMLElement>('[role="dialog"], .drawer');
		const overlay = overlays.item(overlays.length - 1);
		if (!overlay) return;
		const focusableSelector =
			'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
		const focusFirst = window.requestAnimationFrame(() => {
			if (!overlay.contains(document.activeElement)) {
				overlay.querySelector<HTMLElement>(focusableSelector)?.focus();
			}
		});
		const trapFocus = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const focusable = [...overlay.querySelectorAll<HTMLElement>(focusableSelector)].filter(
				(element) => element.getClientRects().length > 0,
			);
			const first = focusable[0];
			const last = focusable.at(-1);
			if (!first || !last) return;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", trapFocus);
		return () => {
			window.cancelAnimationFrame(focusFirst);
			document.removeEventListener("keydown", trapFocus);
			if (previousFocus?.isConnected) previousFocus.focus();
		};
	}, [visible]);
}
