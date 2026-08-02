import { ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import type { ChangeFile, FileDiff } from "../../shared/contracts.ts";
import { changeLabel, stageLabel } from "../features/staging/changeFiles.ts";

interface CurrentFileBarProps {
	activeFile: ChangeFile | null;
	activeFileIndex: number;
	diff: FileDiff | null;
	fileCount: number;
	onNavigate: (direction: -1 | 1) => void;
	onOpenSettings: () => void;
	visible: boolean;
}

export function CurrentFileBar({
	activeFile,
	activeFileIndex,
	diff,
	fileCount,
	onNavigate,
	onOpenSettings,
	visible,
}: CurrentFileBarProps) {
	if (!visible) return null;

	return (
		<section className="file-bar" aria-label="Current file">
			<button
				aria-label="Previous file"
				className="icon-button"
				disabled={activeFileIndex <= 0}
				onClick={() => onNavigate(-1)}
				title="Previous file ([)"
				type="button"
			>
				<ChevronLeft size={20} />
			</button>
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
				aria-label="Next file"
				className="icon-button"
				disabled={activeFileIndex < 0 || activeFileIndex >= fileCount - 1}
				onClick={() => onNavigate(1)}
				title="Next file (])"
				type="button"
			>
				<ChevronRight size={20} />
			</button>
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
