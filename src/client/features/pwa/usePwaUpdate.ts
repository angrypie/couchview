import { useEffect, useRef, useState } from "react";
import { shouldApplyPwaUpdate } from "../../pwaUpdatePolicy.ts";
import { useServiceWorkerRegistration } from "./useServiceWorkerRegistration.ts";

interface InstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_DISMISSED_KEY = "couchview:install-hint-dismissed";

interface PwaUpdateOptions {
	updateSafe: boolean;
}

export function usePwaUpdate({ updateSafe }: PwaUpdateOptions) {
	const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
	const [installDismissed, setInstallDismissed] = useState(() => {
		try {
			return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
		} catch {
			return false;
		}
	});
	const { needRefresh, updateServiceWorker } = useServiceWorkerRegistration();
	const launchedAtRef = useRef(window.performance.now());
	const updateRequestedRef = useRef(false);

	const standalone =
		window.matchMedia("(display-mode: standalone)").matches ||
		Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
	const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);

	useEffect(() => {
		const onInstallPrompt = (event: Event) => {
			event.preventDefault();
			setInstallPrompt(event as InstallPromptEvent);
		};
		window.addEventListener("beforeinstallprompt", onInstallPrompt);
		return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
	}, []);

	useEffect(() => {
		if (!needRefresh || updateRequestedRef.current) return;
		const applyWhenAppropriate = () => {
			if (
				updateRequestedRef.current ||
				!shouldApplyPwaUpdate(
					updateSafe,
					document.visibilityState,
					window.performance.now() - launchedAtRef.current,
				)
			) {
				return;
			}
			updateRequestedRef.current = true;
			void updateServiceWorker(true).catch((error) => {
				updateRequestedRef.current = false;
				console.warn("Service worker activation failed", error);
			});
		};
		applyWhenAppropriate();
		document.addEventListener("visibilitychange", applyWhenAppropriate);
		return () => document.removeEventListener("visibilitychange", applyWhenAppropriate);
	}, [needRefresh, updateSafe, updateServiceWorker]);

	const dismissInstall = () => {
		setInstallDismissed(true);
		try {
			localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
		} catch {
			// The hint can still be dismissed for this page session.
		}
	};

	return {
		canInstall: Boolean(installPrompt) && !standalone && !installDismissed,
		dismissInstall,
		install: async () => {
			if (!installPrompt) return;
			await installPrompt.prompt();
			const choice = await installPrompt.userChoice;
			if (choice.outcome === "accepted") dismissInstall();
			setInstallPrompt(null);
		},
		iosInstallHint: ios && !standalone && !installDismissed,
	};
}
