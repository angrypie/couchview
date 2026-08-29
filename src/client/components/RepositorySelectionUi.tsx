import type { useQuickPickers } from "../features/quickPick/useQuickPickers.ts";
import type { useRepositoryManagement } from "../features/repositories/useRepositoryManagement.ts";
import type { useRepositoryWorkspace } from "../features/repositories/useRepositoryWorkspace.ts";
import { QuickPickerDialog } from "./quickPick";
import { RepositoryPickerSheet } from "./RepositoryPickerSheet.tsx";

interface RepositorySelectionUiProps {
	management: ReturnType<typeof useRepositoryManagement>;
	onOpenNativeSetup: () => void;
	quickPicker: ReturnType<typeof useQuickPickers>;
	workspace: ReturnType<typeof useRepositoryWorkspace>;
}

export function RepositorySelectionUi({
	management,
	onOpenNativeSetup,
	quickPicker,
	workspace,
}: RepositorySelectionUiProps) {
	return (
		<>
			<QuickPickerDialog controller={quickPicker} onManageProjects={management.openPicker} />
			<RepositoryPickerSheet
				addBusy={management.addBusy}
				addRoot={management.addRoot}
				currentRepositoryId={workspace.repositoryId}
				directoryBrowser={management.directoryBrowser}
				forgetBusy={management.forgetBusy}
				nativeSetupAvailable={Boolean(workspace.repositoryId && workspace.repository)}
				onAdd={() => void management.addRepository()}
				onAddDirectory={(path) => void management.addRepository(path)}
				onAddRootChange={management.setAddRoot}
				onClose={() => management.setPickerOpen(false)}
				onForget={(entry) => void management.forgetRepository(entry)}
				onOpenNativeSetup={() => {
					management.setPickerOpen(false);
					onOpenNativeSetup();
				}}
				onRebuild={() => void management.rebuildAndRestart()}
				onSelect={management.selectRepository}
				open={management.pickerOpen}
				repositories={workspace.bootstrap?.repositories ?? []}
				restart={workspace.bootstrap?.restart ?? null}
				restartPhase={management.restartPhase}
			/>
		</>
	);
}
