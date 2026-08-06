import {
	NATIVE_PRODUCT_SURFACE_QUERY,
	NATIVE_PRODUCT_SURFACE_VALUE,
} from "../../shared/nativeClients.ts";

export const NATIVE_SERVER_MANAGER_URL = "couchview://servers";

export function isNativeProductSurface(search = window.location.search): boolean {
	return (
		new URLSearchParams(search).get(NATIVE_PRODUCT_SURFACE_QUERY) === NATIVE_PRODUCT_SURFACE_VALUE
	);
}
