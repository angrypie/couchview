import { NativeDeferredWorkspace } from "../components/native/NativeDeferredWorkspace.tsx";
import { NativeServerManager } from "../components/native/NativeServerManager.tsx";
import { NativeSettings } from "../components/native/NativeSettings.tsx";
import { NativeTerminalScreen } from "../components/native/NativeTerminalScreen.tsx";
import { NativeWorkbench } from "../components/native/NativeWorkbench.tsx";

export type ProductRouteMode =
	| "review"
	| "history"
	| "artifacts"
	| "settings"
	| "servers"
	| "terminal";

export function ProductRoot({ mode }: { mode: ProductRouteMode }) {
	if (mode === "review") return <NativeWorkbench />;
	if (mode === "settings") return <NativeSettings />;
	if (mode === "servers") return <NativeServerManager />;
	if (mode === "terminal") return <NativeTerminalScreen />;
	return <NativeDeferredWorkspace title={mode === "history" ? "History" : "Artifacts"} />;
}
