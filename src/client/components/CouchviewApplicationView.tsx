import type {
	CommitMessageCapability,
	RemoteBridgeCapability,
	TerminalCapability,
} from "../../shared/contracts.ts";
import type { ArtifactsController } from "../features/artifacts/index.ts";
import type { useFailureReporting } from "../features/errors/useFailureReporting.ts";
import type { GitWorkspaceController } from "../features/git/index.ts";
import type { useToastNotifications } from "../features/notifications/useToastNotifications.ts";
import type { usePackageRuns } from "../features/packages/usePackageRuns.ts";
import type { usePwaUpdate } from "../features/pwa/usePwaUpdate.ts";
import type { useRepositoryManagement } from "../features/repositories/useRepositoryManagement.ts";
import type { useRepositoryWorkspace } from "../features/repositories/useRepositoryWorkspace.ts";
import type { useReviewWorkflow } from "../features/review/useReviewWorkflow.ts";
import type { useDisplayPreferences } from "../features/settings/useDisplayPreferences.ts";
import type { useSettingsProfiles } from "../features/settings/useSettingsProfiles.ts";
import type { useThemePreference } from "../features/settings/useThemePreference.ts";
import type { useReviewShellCommands } from "../features/shell/useReviewShellCommands.ts";
import type { useWorkspaceNavigation } from "../features/shell/useWorkspaceNavigation.ts";
import type { DrawerView } from "../features/staging/types.ts";
import type { useChangedFileFilters } from "../features/staging/useChangedFileFilters.ts";
import { isNativeProductSurface, NATIVE_SERVER_MANAGER_URL } from "../lib/nativeProductSurface.ts";
import { formatShortcut } from "../shortcutEngine.ts";
import { ApplicationStateView } from "./ApplicationStateView.tsx";
import { AppToastStack } from "./AppToastStack.tsx";
import { ArtifactsPage } from "./artifacts/index.ts";
import { FailureDetailsSheet } from "./FailureDetailsSheet.tsx";
import { GlobalCommandUi } from "./GlobalCommandUi.tsx";
import { GitHistoryPage } from "./git/index.ts";
import { ProfileSettingsPage } from "./ProfileSettingsPage.tsx";
import { RestartOverlay } from "./RestartOverlay.tsx";
import { ReviewWorkspaceChrome } from "./ReviewWorkspaceChrome.tsx";
import { ReviewWorkspaceOverlays } from "./ReviewWorkspaceOverlays.tsx";
import { TerminalWorkspace } from "./TerminalWorkspace.tsx";

interface CouchviewApplicationViewProps {
	artifacts: ArtifactsController;
	commitMessageCapability: CommitMessageCapability;
	compactLandscape: boolean;
	display: ReturnType<typeof useDisplayPreferences>;
	drawerOpen: boolean;
	drawerView: DrawerView;
	failure: ReturnType<typeof useFailureReporting>;
	filters: ReturnType<typeof useChangedFileFilters>;
	git: GitWorkspaceController;
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
	theme: ReturnType<typeof useThemePreference>;
	workflow: ReturnType<typeof useReviewWorkflow>;
	workspace: ReturnType<typeof useRepositoryWorkspace>;
}

export function CouchviewApplicationView({
	artifacts,
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
	theme,
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
	const toastUi = (
		<AppToastStack
			canInstall={pwa.canInstall}
			failureAvailable={Boolean(failure.failure)}
			iosInstallHint={pwa.iosInstallHint}
			onDismissInstall={pwa.dismissInstall}
			onInstall={() => void pwa.install()}
			onOpenFailure={() => {
				notifications.setToast(null);
				failure.setDetailsOpen(true);
			}}
			onUndo={(undo) => void workflow.review.undoReview(undo)}
			toast={notifications.toast}
		/>
	);

	if (navigation.mode === "settings" && workspace.phase === "ready" && workspace.bootstrap) {
		return (
			<>
				{terminal}
				<ProfileSettingsPage
					busy={settings.busy}
					commandPaletteShortcut={commandPaletteShortcut}
					nativeServerManagerUrl={isNativeProductSurface() ? NATIVE_SERVER_MANAGER_URL : null}
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
					theme={theme}
				/>
				{commandUi}
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

	if (navigation.mode === "history") {
		return (
			<>
				{terminal}
				{commandUi}
				<GitHistoryPage
					commandPaletteShortcut={commandPaletteShortcut}
					controller={git}
					display={display}
					files={workspace.files}
					onBack={navigation.closeGitHistory}
					onOpenCommandPalette={() => shellCommands.setPaletteOpen(true)}
					repository={workspace.repository}
					themeType={theme.resolvedTheme}
				/>
				{toastUi}
				<FailureDetailsSheet
					failure={failure.failure}
					onClose={() => failure.setDetailsOpen(false)}
					onCopy={() => void failure.copyDiagnostics()}
					open={failure.detailsOpen}
				/>
			</>
		);
	}

	if (navigation.mode === "artifacts") {
		return (
			<>
				{terminal}
				{commandUi}
				<ArtifactsPage
					commandPaletteShortcut={commandPaletteShortcut}
					controller={artifacts}
					onBack={navigation.closeArtifacts}
					onOpenCommandPalette={() => shellCommands.setPaletteOpen(true)}
					onOpenPairing={() => onRemoteBridgeOpenChange(true)}
					repository={workspace.repository}
					repositoryId={workspace.repositoryId}
				/>
				<ReviewWorkspaceOverlays
					commitMessageCapability={commitMessageCapability}
					failureReporting={failure}
					management={management}
					onRemoteBridgeOpenChange={(open) => {
						onRemoteBridgeOpenChange(open);
						if (!open) void artifacts.refreshDevices();
					}}
					packages={packages}
					remoteBridgeCapability={remoteBridgeCapability}
					remoteBridgeOpen={remoteBridgeOpen}
					showToast={showToast}
					workflow={workflow}
					workspace={workspace}
				/>
				{toastUi}
			</>
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
					management={management}
					onDrawerOpenChange={onDrawerOpenChange}
					onDrawerViewChange={onDrawerViewChange}
					onOpenCommandPalette={() => shellCommands.setPaletteOpen(true)}
					onOpenFailure={() => failure.setDetailsOpen(true)}
					onOpenGitHistory={navigation.openGitHistory}
					onOpenArtifacts={navigation.openArtifacts}
					onOpenRemoteBridge={() => onRemoteBridgeOpenChange(true)}
					onOpenSettings={navigation.openSettings}
					onOpenTerminal={navigation.openTerminal}
					packages={packages}
					remoteBridgeCapability={remoteBridgeCapability}
					splitView={splitView}
					terminalCapability={terminalCapability}
					themeType={theme.resolvedTheme}
					workflow={workflow}
					workspace={workspace}
					workspaceMode={navigation.mode}
				/>
				<ReviewWorkspaceOverlays
					commitMessageCapability={commitMessageCapability}
					failureReporting={failure}
					management={management}
					onRemoteBridgeOpenChange={onRemoteBridgeOpenChange}
					packages={packages}
					remoteBridgeCapability={remoteBridgeCapability}
					remoteBridgeOpen={remoteBridgeOpen}
					showToast={showToast}
					workflow={workflow}
					workspace={workspace}
				/>
				{toastUi}
				<RestartOverlay phase={management.restartPhase} />
			</main>
		</>
	);
}
