import {
	CouchviewApplicationView,
	type CouchviewApplicationViewProps,
} from "./components/CouchviewApplicationView.tsx";
import { useArtifacts } from "./features/artifacts/index.ts";
import { useFailureReporting } from "./features/errors/useFailureReporting.ts";
import { useGitWorkspace } from "./features/git/index.ts";
import { useToastNotifications } from "./features/notifications/useToastNotifications.ts";
import { usePackageRuns } from "./features/packages/usePackageRuns.ts";
import { usePwaUpdate } from "./features/pwa/usePwaUpdate";
import { useRepositoryManagement } from "./features/repositories/useRepositoryManagement.ts";
import { useRepositoryWorkspace } from "./features/repositories/useRepositoryWorkspace.ts";
import { useReviewWorkflow } from "./features/review/useReviewWorkflow.ts";
import { useAppTheme } from "./features/settings/ThemeProvider.tsx";
import { useDisplayPreferences } from "./features/settings/useDisplayPreferences.ts";
import { useSettingsProfiles } from "./features/settings/useSettingsProfiles.ts";
import type { AppRouteConfiguration } from "./features/shell/appRouteConfiguration.ts";
import { resolveHostCapabilities } from "./features/shell/hostCapabilities.ts";
import { useApplicationShellState } from "./features/shell/useApplicationShellState.ts";
import { useReviewShellCommands } from "./features/shell/useReviewShellCommands.ts";
import { useWorkspaceNavigation } from "./features/shell/useWorkspaceNavigation.ts";
import { SpeechProvider } from "./features/speech/index.ts";
import { useChangedFileFilters } from "./features/staging/useChangedFileFilters.ts";
import {
	hostVoiceCommandCapability,
	type UseVoiceCommandsOptions,
	useVoiceCommands,
	withVoiceCommandCapability,
} from "./features/voiceCommands/index.ts";
import { useRememberOpenedRepository } from "./features/workspacePosition/index.ts";
import { useWorkspaceLayout } from "./lib/mediaQuery.ts";

type VoiceCommandApplicationProps = Omit<CouchviewApplicationViewProps, "voiceCommands"> & {
	voiceCommandOptions: UseVoiceCommandsOptions;
};

function VoiceCommandApplication({
	voiceCommandOptions,
	...viewProps
}: VoiceCommandApplicationProps) {
	const voiceCommands = useVoiceCommands(voiceCommandOptions);
	return <CouchviewApplicationView {...viewProps} voiceCommands={voiceCommands} />;
}

export type { AppRouteConfiguration } from "./features/shell/appRouteConfiguration.ts";

export function App({
	accessRefreshAttempted,
	initialMode,
	nativeServerManagerUrl,
	onAccessRefreshHandled,
	onNavigate,
	onManageServers,
	onReload,
	onTerminalLatencyChange,
	onSettingsDirtyChange,
	onRepositorySelection,
	onReviewLocationChange,
	requestedRepositoryId,
	requestedReviewLocation,
	restoreSavedReviewPosition,
	shareBaseUrl,
	terminalLatencyEnabled,
	workspacePosition,
}: AppRouteConfiguration = {}) {
	const theme = useAppTheme();
	const workspace = useRepositoryWorkspace({
		accessRefreshAttempted,
		onAccessRefreshHandled,
		onReload,
		onRepositorySelection,
		requestedRepositoryId,
	});
	const {
		bootstrap,
		clearRepositorySelection,
		files,
		getRepositoryId,
		loadApp,
		loadRepository,
		phase,
		refreshRepositories,
		repository,
		repositoryId,
		repositoryLoading,
		setBootstrap,
	} = workspace;
	useRememberOpenedRepository(
		workspacePosition,
		repositoryId,
		phase === "ready" && !repositoryLoading && repository !== null,
	);
	const notifications = useToastNotifications();
	const { dismissToast, showToast } = notifications;
	const repositoryManagement = useRepositoryManagement({
		bootstrap,
		clearRepositorySelection,
		getRepositoryId,
		loadRepository,
		reloadApplication: onReload ?? loadApp,
		refreshRepositories,
		showToast,
	});
	const { commitMessageCapability, remoteBridgeCapability, speechCapability, terminalCapability } =
		resolveHostCapabilities(bootstrap);
	const navigation = useWorkspaceNavigation({
		bootstrap,
		initialMode,
		onNavigate,
		onSettingsDirtyChange,
		repository,
		repositoryId,
		showToast,
		terminalCapability,
	});
	const settings = useSettingsProfiles({
		active: navigation.mode === "settings",
		bootstrap,
		setBootstrap,
		showToast,
	});
	const artifactWorkflow = useArtifacts({
		active: navigation.mode === "artifacts",
		bootstrap,
		codexPreferences: settings.activeProfile.data.codex,
		proposalCapability: bootstrap?.artifactProposal ?? {
			available: false,
			reason: "Artifact suggestions are unavailable from this Couchview server.",
		},
		remoteBridgeAvailable: remoteBridgeCapability.available,
		repositoryId,
		showToast,
	});
	const failureReporting = useFailureReporting({ showToast });
	const gitWorkspace = useGitWorkspace({
		active: navigation.mode === "history",
		csrfToken: bootstrap?.csrfToken,
		onRepositoryState: workspace.applyRepositoryState,
		operationRevision: workspace.operationRevision,
		reportFailure: failureReporting.reportFailure,
		repositoryId,
		showToast,
	});
	const { clearFailure, setDetailsOpen } = failureReporting;
	const { resetForRepository } = navigation;
	const { setPickerOpen } = repositoryManagement;
	const shell = useApplicationShellState({
		clearFailure,
		clearToast: dismissToast,
		repositoryId,
		resetNavigationForRepository: resetForRepository,
		setFailureDetailsOpen: setDetailsOpen,
		setRepositoryPickerOpen: setPickerOpen,
	});
	const packageWorkflow = usePackageRuns({
		bootstrap,
		onRunOpened: shell.closeDrawer,
		panelActive: shell.drawerView === "commands",
		repositoryId,
		repositoryReady: phase === "ready" && !repositoryLoading,
		showToast,
	});
	const displayPreferences = useDisplayPreferences({
		profile: settings.activeProfile,
		themeType: theme.resolvedTheme,
		updateProfileData: settings.updateActiveProfileData,
	});

	// Portrait tablets keep the diff full width and open the file list as a
	// drawer. Landscape tablets and genuinely wide portrait windows have enough
	// room for the persistent split view.
	const { compactLandscape, splitView } = useWorkspaceLayout();
	const fileFilters = useChangedFileFilters(files);
	const { stagedCount } = fileFilters;
	const workflow = useReviewWorkflow({
		active: navigation.mode === "review",
		closeDrawer: shell.closeDrawer,
		commitMessageCapability,
		codexPreferences: settings.activeProfile.data.codex,
		dismissToast,
		onReviewLocationChange,
		onShowReview: navigation.showReview,
		refreshPackageScripts: packageWorkflow.refreshScripts,
		reportFailure: failureReporting.reportFailure,
		showToast,
		requestedReviewLocation,
		restoreSavedReviewPosition,
		shareBaseUrl,
		stagedCount,
		workspace,
		workspacePosition,
	});
	const { commit, review, staging } = workflow;

	const pwaUpdateSafe =
		!(navigation.mode === "settings" && navigation.settingsDirty) &&
		!commit.open &&
		!review.busy &&
		!staging.busy &&
		staging.bulkBusy === null &&
		!commit.busy &&
		!commit.messageBusy &&
		packageWorkflow.runBusy === null &&
		artifactWorkflow.busyCount === 0 &&
		!artifactWorkflow.hasActiveRuns &&
		!repositoryManagement.addBusy &&
		repositoryManagement.forgetBusy === null &&
		repositoryManagement.restartPhase === null;
	const gitUpdateSafe = navigation.mode !== "history" && gitWorkspace.actionBusy === null;
	const pwa = usePwaUpdate({ updateSafe: pwaUpdateSafe && gitUpdateSafe });

	const shellCommands = useReviewShellCommands({
		display: displayPreferences,
		drawerOpen: shell.drawerOpen,
		failure: failureReporting,
		git: gitWorkspace,
		management: repositoryManagement,
		navigation,
		onDrawerOpenChange: shell.setDrawerOpen,
		onDrawerViewChange: shell.setDrawerView,
		onRemoteBridgeOpenChange: shell.setRemoteBridgeOpen,
		packages: packageWorkflow,
		remoteBridgeOpen: shell.remoteBridgeOpen,
		splitView,
		stagedCount,
		voiceCommandsEnabled: settings.activeProfile.data.voice.commandsEnabled,
		workflow,
		workspace,
	});
	return (
		<SpeechProvider
			capability={speechCapability}
			connected={workspace.connectionState === "connected"}
			csrfToken={bootstrap?.csrfToken ?? null}
		>
			<VoiceCommandApplication
				artifacts={artifactWorkflow}
				commitMessageCapability={commitMessageCapability}
				compactLandscape={compactLandscape}
				display={displayPreferences}
				drawerOpen={shell.drawerOpen}
				drawerView={shell.drawerView}
				failure={failureReporting}
				filters={fileFilters}
				git={gitWorkspace}
				management={repositoryManagement}
				nativeServerManagerUrl={nativeServerManagerUrl ?? null}
				navigation={navigation}
				notifications={notifications}
				onDrawerOpenChange={shell.setDrawerOpen}
				onDrawerViewChange={shell.setDrawerView}
				onManageServers={onManageServers}
				onRemoteBridgeOpenChange={shell.setRemoteBridgeOpen}
				packages={packageWorkflow}
				pwa={pwa}
				remoteBridgeCapability={remoteBridgeCapability}
				remoteBridgeOpen={shell.remoteBridgeOpen}
				requestedRepositoryId={requestedRepositoryId ?? null}
				settings={settings}
				shellCommands={shellCommands}
				showToast={showToast}
				splitView={splitView}
				terminalCapability={terminalCapability}
				terminalLatencyEnabled={terminalLatencyEnabled}
				theme={theme}
				onTerminalLatencyChange={onTerminalLatencyChange}
				voiceCommandOptions={{
					active: navigation.mode !== "terminal",
					activeFile: workflow.diff.activeFile,
					capability: hostVoiceCommandCapability(bootstrap),
					commands: shellCommands.commands,
					csrfToken: bootstrap?.csrfToken ?? null,
					enabled: settings.activeProfile.data.voice.commandsEnabled,
					getOperationRevision: workspace.getOperationRevision,
					getRepositoryId: workspace.getRepositoryId,
					getReviewRevision: workflow.review.getReviewRevision,
					onCapability: (capability) =>
						workspace.setBootstrap((current) => withVoiceCommandCapability(current, capability)),
					openPaletteWithQuery: shellCommands.openPaletteWithQuery,
					refreshChanges: workspace.refreshChanges,
					refreshReviews: workflow.review.refreshReviewState,
				}}
				workflow={workflow}
				workspace={workspace}
			/>
		</SpeechProvider>
	);
}
