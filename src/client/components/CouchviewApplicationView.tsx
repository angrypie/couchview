import type {
	CodexCapability,
	CommitMessageCapability,
	RemoteBridgeCapability,
	TerminalCapability,
} from "../../shared/contracts.ts";
import type { useFailureReporting } from "../features/errors/useFailureReporting.ts";
import type { useGitWorkspace } from "../features/history/useGitWorkspace.ts";
import type { useToastNotifications } from "../features/notifications/useToastNotifications.ts";
import type { usePackageRuns } from "../features/packages/usePackageRuns.ts";
import type { usePwaUpdate } from "../features/pwa/usePwaUpdate.ts";
import type { useRepositoryManagement } from "../features/repositories/useRepositoryManagement.ts";
import type { useRepositoryWorkspace } from "../features/repositories/useRepositoryWorkspace.ts";
import type { useReviewWorkflow } from "../features/review/useReviewWorkflow.ts";
import type { useDisplayPreferences } from "../features/settings/useDisplayPreferences.ts";
import type { useSettingsProfiles } from "../features/settings/useSettingsProfiles.ts";
import type { useReviewShellCommands } from "../features/shell/useReviewShellCommands.ts";
import type { useWorkspaceNavigation } from "../features/shell/useWorkspaceNavigation.ts";
import type { DrawerView } from "../features/staging/types.ts";
import type { useChangedFileFilters } from "../features/staging/useChangedFileFilters.ts";
import { formatShortcut } from "../shortcutEngine.ts";
import { ApplicationStateView } from "./ApplicationStateView.tsx";
import { AppToastStack } from "./AppToastStack.tsx";
import { GlobalCommandUi } from "./GlobalCommandUi.tsx";
import { ProfileSettingsPage } from "./ProfileSettingsPage.tsx";
import { PwaRefreshToast } from "./PwaRefreshToast.tsx";
import { RestartOverlay } from "./RestartOverlay.tsx";
import { ReviewWorkspaceChrome } from "./ReviewWorkspaceChrome.tsx";
import { ReviewWorkspaceOverlays } from "./ReviewWorkspaceOverlays.tsx";
import { TerminalWorkspace } from "./TerminalWorkspace.tsx";

interface CouchviewApplicationViewProps {
	codexCapability: CodexCapability;
	commitMessageCapability: CommitMessageCapability;
	compactLandscape: boolean;
	display: ReturnType<typeof useDisplayPreferences>;
	drawerOpen: boolean;
	drawerView: DrawerView;
	failure: ReturnType<typeof useFailureReporting>;
	filters: ReturnType<typeof useChangedFileFilters>;
	git: ReturnType<typeof useGitWorkspace>;
	management: ReturnType<typeof useRepositoryManagement>;
	navigation: ReturnType<typeof useWorkspaceNavigation>;
	notifications: ReturnType<typeof useToastNotifications>;
	onDrawerOpenChange: (open: boolean) => void;
	onDrawerViewChange: (view: DrawerView) => void;
	onRemoteBridgeOpenChange: (open: boolean) => void;
	packages: ReturnType<typeof usePackageRuns>;
	pwa: ReturnType<typeof usePwaUpdate>;
	remoteBridgeCapability: RemoteBridgeCapability;
	remoteBridgeOpen: boolean;
	settings: ReturnType<typeof useSettingsProfiles>;
	shellCommands: ReturnType<typeof useReviewShellCommands>;
	showToast: (message: string) => void;
	splitView: boolean;
	terminalCapability: TerminalCapability;
	workflow: ReturnType<typeof useReviewWorkflow>;
	workspace: ReturnType<typeof useRepositoryWorkspace>;
}

export function CouchviewApplicationView({
	codexCapability,
	commitMessageCapability,
	compactLandscape,
	display,
	drawerOpen,
	drawerView,
	failure,
	filters,
	git,
	management,
	navigation,
	notifications,
	onDrawerOpenChange,
	onDrawerViewChange,
	onRemoteBridgeOpenChange,
	packages,
	pwa,
	remoteBridgeCapability,
	remoteBridgeOpen,
	settings,
	shellCommands,
	showToast,
	splitView,
	terminalCapability,
	workflow,
	workspace,
}: CouchviewApplicationViewProps) {
	const commandPaletteShortcut = formatShortcut(display.commandBindings["palette.open"]);
	const terminal =
		navigation.terminalOpened &&
		workspace.bootstrap &&
		workspace.repositoryId &&
		workspace.repository ? (
			<TerminalWorkspace
				active={navigation.mode === "terminal"}
				capability={terminalCapability}
				commandPaletteShortcut={commandPaletteShortcut}
				csrfToken={workspace.bootstrap.csrfToken}
				onBack={() => navigation.setMode("review")}
				onEnded={() => showToast("tmux session ended")}
				onNotice={showToast}
				onOpenCommandPalette={() => shellCommands.setPaletteOpen(true)}
				rendererConfig={display.terminalConfig}
				repositoryId={workspace.repositoryId}
				repositoryName={workspace.repository.name}
			/>
		) : null;
	const commandUi = (
		<GlobalCommandUi
			commands={shellCommands.commands}
			onOpenChange={shellCommands.setPaletteOpen}
			open={shellCommands.paletteOpen}
			pendingShortcut={shellCommands.pending}
		/>
	);

	if (navigation.mode === "settings" && workspace.phase === "ready" && workspace.bootstrap) {
		return (
			<>
				{terminal}
				<ProfileSettingsPage
					busy={settings.busy}
					commandPaletteShortcut={commandPaletteShortcut}
					onBack={navigation.closeSettings}
					onCreate={(name) => settings.createProfile(name)}
					onDelete={settings.deleteProfile}
					onDirtyChange={navigation.setSettingsDirty}
					onDuplicate={(profileId, name) => settings.createProfile(name, profileId)}
					onOpenCommandPalette={() => shellCommands.setPaletteOpen(true)}
					onRecordingChange={shellCommands.setRecording}
					onSave={settings.saveProfile}
					onSelect={settings.selectProfile}
					profile={settings.activeProfile}
					profiles={settings.profiles}
				/>
				{commandUi}
				{pwa.needRefresh && (
					<div className="toast-stack" aria-live="polite">
						<PwaRefreshToast onDismiss={pwa.dismissRefresh} onUpdate={pwa.update} visible />
					</div>
				)}
			</>
		);
	}

	if (workspace.phase !== "ready") {
		return (
			<ApplicationStateView
				appCacheResetBusy={workspace.appCacheResetBusy}
				commandUi={commandUi}
				compactLandscape={compactLandscape}
				loadError={workspace.loadError}
				loadErrorCode={workspace.loadErrorCode}
				onLoad={workspace.loadApp}
				onResetAppCache={workspace.resetAppCache}
				phase={workspace.phase}
			/>
		);
	}

	return (
		<>
			{terminal}
			{commandUi}
			<main
				className={`app-shell ${compactLandscape ? "compact-landscape" : ""} ${navigation.mode === "terminal" ? "terminal-active" : ""}`}
			>
				<ReviewWorkspaceChrome
					commandPaletteShortcut={commandPaletteShortcut}
					compactLandscape={compactLandscape}
					display={display}
					drawerOpen={drawerOpen}
					drawerView={drawerView}
					failureAvailable={Boolean(failure.failure)}
					filters={filters}
					git={git}
					management={management}
					onDrawerOpenChange={onDrawerOpenChange}
					onDrawerViewChange={onDrawerViewChange}
					onOpenCommandPalette={() => shellCommands.setPaletteOpen(true)}
					onOpenComments={shellCommands.openComments}
					onOpenFailure={() => failure.setDetailsOpen(true)}
					onOpenRemoteBridge={() => onRemoteBridgeOpenChange(true)}
					onOpenSettings={navigation.openSettings}
					onOpenTerminal={navigation.openTerminal}
					packages={packages}
					remoteBridgeCapability={remoteBridgeCapability}
					splitView={splitView}
					terminalCapability={terminalCapability}
					workflow={workflow}
					workspace={workspace}
					workspaceMode={navigation.mode}
				/>
				<ReviewWorkspaceOverlays
					codexCapability={codexCapability}
					commitMessageCapability={commitMessageCapability}
					display={display}
					failureReporting={failure}
					git={git}
					management={management}
					onRemoteBridgeOpenChange={onRemoteBridgeOpenChange}
					packages={packages}
					remoteBridgeCapability={remoteBridgeCapability}
					remoteBridgeOpen={remoteBridgeOpen}
					showToast={showToast}
					workflow={workflow}
					workspace={workspace}
				/>
				<AppToastStack
					canInstall={pwa.canInstall}
					failureAvailable={Boolean(failure.failure)}
					iosInstallHint={pwa.iosInstallHint}
					onDismissInstall={pwa.dismissInstall}
					onDismissRefresh={pwa.dismissRefresh}
					onInstall={() => void pwa.install()}
					onOpenFailure={() => {
						notifications.setToast(null);
						failure.setDetailsOpen(true);
					}}
					onUndo={(undo) => void workflow.review.undoReview(undo)}
					onUpdate={pwa.update}
					refreshAvailable={pwa.needRefresh}
					toast={notifications.toast}
				/>
				<RestartOverlay phase={management.restartPhase} />
			</main>
		</>
	);
}
