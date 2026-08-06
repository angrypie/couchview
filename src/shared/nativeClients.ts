export const NATIVE_CLIENT_PROTOCOL = "couchview-native-v1";
export const NATIVE_CLIENT_TOKEN_HEADER = "x-couchview-client-token";
export const NATIVE_PRODUCT_SURFACE_QUERY = "couchviewNative";
export const NATIVE_PRODUCT_SURFACE_VALUE = "1";

export interface NativeClientDevice {
	id: string;
	label: string;
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
}

export interface NativeClientPairingResponse {
	protocol: typeof NATIVE_CLIENT_PROTOCOL;
	baseUrl: string;
	serverId: string;
	code: string;
	expiresAt: string;
	deepLink: string;
}

export interface ClaimNativeClientPairingRequest {
	code: string;
	deviceLabel: string;
}

export interface NativeClientClaimResponse {
	protocol: typeof NATIVE_CLIENT_PROTOCOL;
	serverId: string;
	device: NativeClientDevice;
	token: string;
}

export interface NativeClientsResponse {
	devices: NativeClientDevice[];
}

export function normalizeNativeClientLabel(value: unknown): string {
	if (typeof value !== "string") throw new Error("Device label is required");
	const label = value.trim().replace(/\s+/g, " ");
	if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) {
		throw new Error("Device label must be between 1 and 80 printable characters");
	}
	return label;
}

export function nativeClientPairingCodeIsValid(value: unknown): value is string {
	return typeof value === "string" && /^[A-HJ-NP-Z2-9]{8}$/.test(value);
}
