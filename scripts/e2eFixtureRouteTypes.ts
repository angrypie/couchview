import type {
	ArtifactBuild,
	ArtifactDefinition,
	ArtifactRun,
	ArtifactRunOutputChunk,
	NativeClientDevice,
	PackageRunSummary,
	SettingsProfile,
} from "../src/shared/contracts.ts";
import type { FixtureTerminal } from "./e2eFixtureTerminal.ts";

export interface FixtureMutableState {
	artifactBuilds: ArtifactBuild[];
	artifactDefinitions: ArtifactDefinition[];
	artifactPayloads: Map<string, Uint8Array>;
	artifactRunOutputs: Map<string, ArtifactRunOutputChunk[]>;
	artifactRuns: ArtifactRun[];
	artifactTimers: Set<ReturnType<typeof setTimeout>>;
	gitDetached: boolean;
	gitHead: string;
	gitStashCount: number;
	nativeClients: NativeClientDevice[];
	nativePairingCounter: number;
	operationRevision: string;
	packageRuns: PackageRunSummary[];
	settingsProfileCounter: number;
	settingsProfiles: SettingsProfile[];
	terminal: FixtureTerminal;
	reset(): void;
}

export interface FixtureRequestContext {
	request: Request;
	url: URL;
	repositoryId: string | null;
	nestedPath: string;
	selectedRepository: {
		id: string;
		name: string;
		root: string;
		branch: string | null;
		head: string;
		unborn: boolean;
	} | null;
	fileRoute: RegExpExecArray | null;
	commentRoute: RegExpExecArray | null;
	packageRunRoute: RegExpExecArray | null;
	artifactRoute: RegExpExecArray | null;
	artifactRunRoute: RegExpExecArray | null;
	artifactDownloadRoute: RegExpExecArray | null;
}
