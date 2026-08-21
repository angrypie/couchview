import { useAtomValue, useSetAtom } from "jotai/react";
import { useEffect, useRef, useState } from "react";
import { useHydratePersistedAtom } from "../../lib/store/persistedAtom.ts";
import { shouldApplyPwaUpdate } from "../../pwaUpdatePolicy.ts";
import { pwaInstallDismissalState } from "./installDismissalState.ts";
import { useServiceWorkerRegistration } from "./useServiceWorkerRegistration.ts";

interface InstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaUpdateOptions {
	updateSafe: boolean;
}

export function usePwaUpdate({ updateSafe }: PwaUpdateOptions) {
	const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
	const installDismissed = useAtomValue(pwaInstallDismissalState.valueAtom);
	const installDismissalHydrated = useAtomValue(pwaInstallDismissalState.hydratedAtom);
	const setInstallDismissed = useSetAtom(pwaInstallDismissalState.valueAtom);
	useHydratePersistedAtom(pwaInstallDismissalState);
	const { needRefresh, updateServiceWorker } = useServiceWorkerRegistration(false);
	const launchedAtRef = useRef(window.performance.now());
	const updateRequestedRef = useRef(false);

	const standalone =
		window.matchMedia("(display-mode: standalone)").matches ||
		Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
	const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
	const canShowInstallHint = installDismissalHydrated && !standalone && !installDismissed;

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
		void setInstallDismissed(true).catch(() => undefined);
	};

	return {
		canInstall: Boolean(installPrompt) && canShowInstallHint,
		dismissInstall,
		install: async () => {
			if (!installPrompt) return;
			await installPrompt.prompt();
			const choice = await installPrompt.userChoice;
			if (choice.outcome === "accepted") dismissInstall();
			setInstallPrompt(null);
		},
		iosInstallHint: ios && canShowInstallHint,
	};
}
