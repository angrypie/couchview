import { NativeProductSurface } from "../components/native/NativeProductSurface.tsx";
import { NativeServerManager } from "../components/native/NativeServerManager.tsx";
import type { ProductRouteMode } from "./productRouteMode.ts";

export function ProductRoot({ mode }: { mode: ProductRouteMode }) {
	if (mode === "servers") return <NativeServerManager />;
	return <NativeProductSurface mode={mode} />;
}
