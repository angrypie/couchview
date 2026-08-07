import { Settings2 } from "lucide-react";
import type { FileChange, FileDiff } from "../../shared/contracts.ts";
import { changeLabel, stageLabel } from "../features/staging/changeFiles.ts";

interface CurrentFileBarProps {
	activeFile: FileChange | null;
	diff: FileDiff | null;
	onOpenSettings: () => void;
	visible: boolean;
}

export function CurrentFileBar({ activeFile, diff, onOpenSettings, visible }: CurrentFileBarProps) {
	if (!visible) return null;

	return (
		<section className="file-bar" aria-label="Current file">
			<div className="file-summary">
				<div className="file-path" title={activeFile?.path}>
					{activeFile?.path ?? "No changed file"}
				</div>
				{activeFile && (
					<div className="file-meta">
						<span className="status-pill">{changeLabel(activeFile)}</span>
						<span className="additions">+{activeFile.additions ?? diff?.additions ?? 0}</span>
						<span className="deletions">−{activeFile.deletions ?? diff?.deletions ?? 0}</span>
						{activeFile.reviewed && <span className="status-pill reviewed">reviewed</span>}
						{stageLabel(activeFile) && (
							<span className={`status-pill ${stageLabel(activeFile)}`}>
								{stageLabel(activeFile)}
							</span>
						)}
					</div>
				)}
			</div>
			<button
				aria-label="Open settings"
				className="icon-button settings-launch-button"
				onClick={onOpenSettings}
				title="Typography settings"
				type="button"
			>
				<Settings2 size={18} />
			</button>
		</section>
	);
}
