interface PwaUpdateOptions {
	updateSafe: boolean;
}

export function usePwaUpdate(_options: PwaUpdateOptions) {
	return {
		canInstall: false,
		dismissInstall: () => undefined,
		install: async () => undefined,
		iosInstallHint: false,
	};
}
