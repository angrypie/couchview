import { LoaderCircle } from "lucide-react";
import type { RestartPhase } from "../features/repositories/types.ts";

export type { RestartPhase };

interface RestartOverlayProps {
	phase: RestartPhase;
}

export function RestartOverlay({ phase }: RestartOverlayProps) {
	if (!phase) return null;

	return (
		<div aria-live="assertive" className="restart-overlay" role="status">
			<LoaderCircle className="spinner" size={30} />
			<h2 className="state-title">
				{phase === "building"
					? "Building Couchview…"
					: phase === "restarting"
						? "Restarting Couchview…"
						: "Loading the new build…"}
			</h2>
			<p className="state-copy">
				Keep this page open. Your repository selection and review state will be restored.
			</p>
		</div>
	);
}
