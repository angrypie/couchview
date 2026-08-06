import { App } from "../App.tsx";

import type { ProductRouteMode } from "./productRouteMode.ts";

export function ProductRoot({ mode: _mode }: { mode: ProductRouteMode }) {
	return <App />;
}
