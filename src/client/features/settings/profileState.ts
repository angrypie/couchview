import type { SettingsProfile } from "../../../shared/contracts.ts";
import {
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
	SETTINGS_PROFILE_SELECTION_KEY,
} from "../../../shared/settings.ts";

export const SETTINGS_PATH = "/settings";

export function fallbackSettingsProfile(): SettingsProfile {
	return {
		id: DEFAULT_SETTINGS_PROFILE_ID,
		name: "Default",
		data: createDefaultSettingsProfileData(),
		revision: 1,
		createdAt: "",
		updatedAt: "",
	};
}

export function storedSettingsProfileId(): string {
	try {
		return localStorage.getItem(SETTINGS_PROFILE_SELECTION_KEY) ?? DEFAULT_SETTINGS_PROFILE_ID;
	} catch {
		return DEFAULT_SETTINGS_PROFILE_ID;
	}
}

export function isSettingsPath(pathname = window.location.pathname): boolean {
	return pathname.replace(/\/+$/, "") === SETTINGS_PATH;
}
