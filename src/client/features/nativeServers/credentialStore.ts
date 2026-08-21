function credentialKey(serverId: string): string {
	return `couchview.native.credential.${serverId}`;
}

function storage(): Storage | null {
	return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

export const nativeCredentialStore = {
	async get(serverId: string): Promise<string | null> {
		return storage()?.getItem(credentialKey(serverId)) ?? null;
	},
	async set(serverId: string, token: string): Promise<void> {
		storage()?.setItem(credentialKey(serverId), token);
	},
	async remove(serverId: string): Promise<void> {
		storage()?.removeItem(credentialKey(serverId));
	},
};
