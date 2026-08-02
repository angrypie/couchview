interface OfflineAppStorageOptions {
	serviceWorker?: Pick<ServiceWorkerContainer, "getRegistration"> | null;
	cacheStorage?: Pick<CacheStorage, "delete" | "keys"> | null;
}

export async function clearPwaStorage(options: OfflineAppStorageOptions = {}): Promise<void> {
	const serviceWorker =
		"serviceWorker" in options
			? options.serviceWorker
			: typeof navigator !== "undefined" && "serviceWorker" in navigator
				? navigator.serviceWorker
				: null;
	const cacheStorage =
		"cacheStorage" in options
			? options.cacheStorage
			: typeof window !== "undefined" && "caches" in window
				? window.caches
				: null;

	const registration = await serviceWorker?.getRegistration();
	await registration?.unregister();
	if (!cacheStorage) return;
	const cacheNames = await cacheStorage.keys();
	await Promise.all(cacheNames.map((name) => cacheStorage.delete(name)));
}
