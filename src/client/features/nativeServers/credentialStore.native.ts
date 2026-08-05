import * as SecureStore from "expo-secure-store";

function credentialKey(serverId: string): string {
	return `couchview.native.credential.${serverId}`;
}

export const nativeCredentialStore = {
	get(serverId: string): Promise<string | null> {
		return SecureStore.getItemAsync(credentialKey(serverId));
	},
	set(serverId: string, token: string): Promise<void> {
		return SecureStore.setItemAsync(credentialKey(serverId), token, {
			keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
		});
	},
	remove(serverId: string): Promise<void> {
		return SecureStore.deleteItemAsync(credentialKey(serverId));
	},
};
