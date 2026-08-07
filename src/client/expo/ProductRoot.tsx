import { NativeServerManager } from "../components/native/NativeServerManager.tsx";
import { NativeProductRoot } from "./NativeProductRoot.tsx";
import type { ProductRouteMode } from "./productRouteMode.ts";

export function ProductRoot({ mode }: { mode: ProductRouteMode }) {
	if (mode === "servers") return <NativeServerManager />;
	return <NativeProductRoot mode={mode} />;
}
