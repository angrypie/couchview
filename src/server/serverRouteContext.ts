import type { ArtifactProposalGenerator } from "./artifactProposal.ts";
import type { ArtifactService } from "./artifactService.ts";
import type { CodexAppServerService } from "./codexAppServer.ts";
import type { CommitMessageGenerator } from "./commitMessage.ts";
import type { StateDatabase } from "./database.ts";
import type { PackageCommandService } from "./packageCommands.ts";
import type { RemoteBridgeService } from "./remoteBridgeService.ts";
import type { RepositoryManager } from "./repositories.ts";
import type { ServerEventStreams } from "./serverEvents.ts";
import type { TerminalSessionService } from "./terminalSessions.ts";

export interface RepositoryRouteContext {
	database: StateDatabase;
	artifacts: ArtifactService;
	artifactProposals: ArtifactProposalGenerator;
	repositories: RepositoryManager;
	packageCommands: PackageCommandService;
	commitMessages: CommitMessageGenerator;
	codex: CodexAppServerService;
	terminalSessions: TerminalSessionService;
	remoteBridge: RemoteBridgeService;
	remoteBridgeOriginAccess: string;
	events: ServerEventStreams;
	defaultRepositoryId(): string | null;
	setDefaultRepositoryId(repositoryId: string | null): void;
}
