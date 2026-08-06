import {
	NATIVE_PRODUCT_SURFACE_QUERY,
	NATIVE_PRODUCT_SURFACE_VALUE,
} from "../../../shared/nativeClients.ts";
import type { ProductRouteMode } from "../../expo/productRouteMode.ts";

const PRODUCT_PATHS: Record<ProductRouteMode, string> = {
	review: "/",
	history: "/history",
	artifacts: "/artifacts",
	settings: "/settings",
	servers: "/",
	terminal: "/",
};

export function nativeProductUrl(
	baseUrl: string,
	mode: ProductRouteMode,
	repositoryId: string | null,
): string {
	const url = new URL(PRODUCT_PATHS[mode], `${baseUrl}/`);
	url.searchParams.set(NATIVE_PRODUCT_SURFACE_QUERY, NATIVE_PRODUCT_SURFACE_VALUE);
	if (repositoryId) url.searchParams.set("repo", repositoryId);
	return url.toString();
}
