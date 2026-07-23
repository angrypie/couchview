/// <reference types="vite-plugin-pwa/react" />

import { useRegisterSW } from "virtual:pwa-register/react";
import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_DISMISSED_KEY = "couchview:install-hint-dismissed";
const LEGACY_INSTALL_DISMISSED_KEY = "couch-review:install-hint-dismissed";

export function usePwaUpdate() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(() => {
    try {
      const current = localStorage.getItem(INSTALL_DISMISSED_KEY);
      const stored = current ?? localStorage.getItem(LEGACY_INSTALL_DISMISSED_KEY);
      if (current === null && stored !== null) {
        localStorage.setItem(INSTALL_DISMISSED_KEY, stored);
      }
      return stored === "1";
    } catch {
      return false;
    }
  });
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.warn("Service worker registration failed", error);
    },
  });

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

  const dismissInstall = () => {
    setInstallDismissed(true);
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      // The hint can still be dismissed for this page session.
    }
  };

  return {
    offlineReady,
    needRefresh,
    dismissOfflineReady: () => setOfflineReady(false),
    dismissRefresh: () => setNeedRefresh(false),
    update: () => void updateServiceWorker(true),
    canInstall: Boolean(installPrompt) && !standalone && !installDismissed,
    iosInstallHint: ios && !standalone && !installDismissed,
    dismissInstall,
    install: async () => {
      if (!installPrompt) return;
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") dismissInstall();
      setInstallPrompt(null);
    },
  };
}
