import { useCallback, useEffect, useRef, useState } from "react";

export function useServiceWorkerRegistration() {
	const [needRefresh, setNeedRefresh] = useState(false);
	const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
	const reloadRequestedRef = useRef(false);

	useEffect(() => {
		if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
		let disposed = false;
		const onControllerChange = () => {
			if (reloadRequestedRef.current) window.location.reload();
		};
		const watchInstallingWorker = (worker: ServiceWorker | null) => {
			if (!worker) return;
			const onStateChange = () => {
				if (worker.state === "installed" && navigator.serviceWorker.controller) {
					setNeedRefresh(true);
				}
			};
			worker.addEventListener("statechange", onStateChange);
		};
		navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
		void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(
			(registration) => {
				if (disposed) return;
				registrationRef.current = registration;
				if (registration.waiting && navigator.serviceWorker.controller) setNeedRefresh(true);
				watchInstallingWorker(registration.installing);
				registration.addEventListener("updatefound", () => {
					watchInstallingWorker(registration.installing);
				});
			},
			(error) => console.warn("Service worker registration failed", error),
		);
		return () => {
			disposed = true;
			navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
		};
	}, []);

	const updateServiceWorker = useCallback(async (reloadPage = false) => {
		const registration =
			registrationRef.current ?? (await navigator.serviceWorker?.getRegistration("/"));
		if (!registration) return;
		registrationRef.current = registration;
		if (reloadPage) reloadRequestedRef.current = true;
		if (registration.waiting) {
			registration.waiting.postMessage({ type: "SKIP_WAITING" });
			setNeedRefresh(false);
			return;
		}
		await registration.update();
	}, []);

	return { needRefresh, updateServiceWorker };
}
