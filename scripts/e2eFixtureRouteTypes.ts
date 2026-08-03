import type { PackageRunSummary, SettingsProfile } from "../src/shared/contracts.ts";
import type { FixtureTerminal } from "./e2eFixtureTerminal.ts";

export interface FixtureMutableState {
	gitDetached: boolean;
	gitHead: string;
	gitStashCount: number;
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
}
