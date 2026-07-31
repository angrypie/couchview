/// <reference types="vite-plugin-pwa/react" />

import { useRegisterSW } from "virtual:pwa-register/react";
import { useEffect, useRef, useState } from "react";
import {
  shouldApplyPwaUpdate,
  shouldShowPwaUpdatePrompt,
} from "./pwaUpdatePolicy.ts";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_DISMISSED_KEY = "couchview:install-hint-dismissed";
const LEGACY_INSTALL_DISMISSED_KEY = "couch-review:install-hint-dismissed";

interface PwaUpdateOptions {
  updateSafe: boolean;
}

export function usePwaUpdate({ updateSafe }: PwaUpdateOptions) {
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
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.warn("Service worker registration failed", error);
    },
  });
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
    needRefresh: shouldShowPwaUpdatePrompt(needRefresh, updateSafe),
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
