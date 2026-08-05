import { useCallback, useEffect, useState } from "react";
import { type DrawerView } from "./components/ChangedFilesDrawer.tsx";
import { CouchviewApplicationView } from "./components/CouchviewApplicationView.tsx";
import { useArtifacts } from "./features/artifacts/index.ts";
import { useFailureReporting } from "./features/errors/useFailureReporting.ts";
import { useGitWorkspace } from "./features/git/index.ts";
import { useToastNotifications } from "./features/notifications/useToastNotifications.ts";
import { usePackageRuns } from "./features/packages/usePackageRuns.ts";
import { usePwaUpdate } from "./features/pwa/usePwaUpdate.ts";
import { useRepositoryManagement } from "./features/repositories/useRepositoryManagement.ts";
import { useRepositoryWorkspace } from "./features/repositories/useRepositoryWorkspace.ts";
import { useReviewWorkflow } from "./features/review/useReviewWorkflow.ts";
import { useDisplayPreferences } from "./features/settings/useDisplayPreferences.ts";
import { useSettingsProfiles } from "./features/settings/useSettingsProfiles.ts";
import { useReviewShellCommands } from "./features/shell/useReviewShellCommands.ts";
import { useWorkspaceNavigation } from "./features/shell/useWorkspaceNavigation.ts";
import { useChangedFileFilters } from "./features/staging/useChangedFileFilters.ts";
import { COMPACT_LANDSCAPE_QUERY, SPLIT_VIEW_QUERY, useMediaQuery } from "./lib/mediaQuery.ts";

export function App() {
	const workspace = useRepositoryWorkspace();
	const {
		bootstrap,
		clearRepositorySelection,
		files,
		getRepositoryId,
		loadRepository,
		phase,
		refreshRepositories,
		repository,
		repositoryId,
		repositoryLoading,
		setBootstrap,
	} = workspace;
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [drawerView, setDrawerView] = useState<DrawerView>("files");
	const [remoteBridgeOpen, setRemoteBridgeOpen] = useState(false);
	const notifications = useToastNotifications();
	const { dismissToast, setToast, showToast } = notifications;
	const repositoryManagement = useRepositoryManagement({
		bootstrap,
		clearRepositorySelection,
		getRepositoryId,
		loadRepository,
		refreshRepositories,
		showToast,
	});
	const commitMessageCapability = bootstrap?.commitMessage ?? {
		available: false,
		reason: "Commit message generation is unavailable from this Couchview server.",
	};
	const codexCapability = bootstrap?.codex ?? {
		available: false,
		reason: "Codex integration is unavailable from this Couchview server.",
	};
	const terminalCapability = bootstrap?.terminal ?? {
		available: false,
		reason: "The browser tmux terminal is unavailable from this Couchview server.",
		persistence: "tmux" as const,
		profiles: [],
	};
	const remoteBridgeCapability = bootstrap?.remoteBridge ?? {
		available: false,
		reason: "Native remote development is unavailable from this Couchview server.",
		p2pEnabled: false,
	};
	const navigation = useWorkspaceNavigation({
		bootstrap,
		clearRepositorySelection,
		getRepositoryId,
		loadRepository,
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
	const closeDrawer = useCallback(() => setDrawerOpen(false), []);
	const packageWorkflow = usePackageRuns({
		bootstrap,
		onRunOpened: closeDrawer,
		panelActive: drawerView === "commands",
		repositoryId,
		repositoryReady: phase === "ready" && !repositoryLoading,
		showToast,
	});
	const displayPreferences = useDisplayPreferences({
		profile: settings.activeProfile,
		updateProfileData: settings.updateActiveProfileData,
	});

	// Portrait tablets keep the diff full width and open the file list as a
	// drawer. Landscape tablets and genuinely wide portrait windows have enough
	// room for the persistent split view.
	const splitView = useMediaQuery(SPLIT_VIEW_QUERY);
	const compactLandscape = useMediaQuery(COMPACT_LANDSCAPE_QUERY) && !splitView;
	const fileFilters = useChangedFileFilters(files);
	const { stagedCount } = fileFilters;
	const workflow = useReviewWorkflow({
		closeDrawer,
		commitMessageCapability,
		codexPreferences: settings.activeProfile.data.codex,
		dismissToast,
		refreshPackageScripts: packageWorkflow.refreshScripts,
		reportFailure: failureReporting.reportFailure,
		showToast,
		stagedCount,
		workspace,
	});
	const { comments, commit, review, staging } = workflow;

	useEffect(() => {
		resetForRepository();
		setDrawerView("files");
		setToast(null);
		clearFailure();
		setDetailsOpen(false);
		setDrawerOpen(false);
		setPickerOpen(false);
	}, [clearFailure, repositoryId, resetForRepository, setDetailsOpen, setPickerOpen, setToast]);

	const pwaUpdateSafe =
		!(navigation.mode === "settings" && navigation.settingsDirty) &&
		!comments.composerOpen &&
		!commit.open &&
		!comments.busy &&
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
		repositoryManagement.restartPhase === null &&
		!comments.copyFallbackText;
	const gitUpdateSafe = navigation.mode !== "history" && gitWorkspace.actionBusy === null;
	const pwa = usePwaUpdate({ updateSafe: pwaUpdateSafe && gitUpdateSafe });

	const shellCommands = useReviewShellCommands({
		display: displayPreferences,
		drawerOpen,
		failure: failureReporting,
		git: gitWorkspace,
		management: repositoryManagement,
		navigation,
		onDrawerOpenChange: setDrawerOpen,
		onDrawerViewChange: setDrawerView,
		onRemoteBridgeOpenChange: setRemoteBridgeOpen,
		packages: packageWorkflow,
		remoteBridgeOpen,
		splitView,
		stagedCount,
		workflow,
		workspace,
	});
	return (
		<CouchviewApplicationView
			artifacts={artifactWorkflow}
			codexCapability={codexCapability}
			commitMessageCapability={commitMessageCapability}
			compactLandscape={compactLandscape}
			display={displayPreferences}
			drawerOpen={drawerOpen}
			drawerView={drawerView}
			failure={failureReporting}
			filters={fileFilters}
			git={gitWorkspace}
			management={repositoryManagement}
			navigation={navigation}
			notifications={notifications}
			onDrawerOpenChange={setDrawerOpen}
			onDrawerViewChange={setDrawerView}
			onRemoteBridgeOpenChange={setRemoteBridgeOpen}
			packages={packageWorkflow}
			pwa={pwa}
			remoteBridgeCapability={remoteBridgeCapability}
			remoteBridgeOpen={remoteBridgeOpen}
			settings={settings}
			shellCommands={shellCommands}
			showToast={showToast}
			splitView={splitView}
			terminalCapability={terminalCapability}
			workflow={workflow}
			workspace={workspace}
		/>
	);
}
