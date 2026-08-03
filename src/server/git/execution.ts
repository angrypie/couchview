import { GitCommandError, type GitResult, type RunGitOptions, runGit } from "./command.ts";

export interface GitExecutionFailure extends Error {
	readonly stderr: string;
}

export interface GitExecutionPort {
	run(args: readonly string[], options?: RunGitOptions): Promise<GitResult>;
	isFailure(error: unknown): error is GitExecutionFailure;
}

export function createCliGitExecutionPort(root: string): GitExecutionPort {
	return {
		run: (args, options) => runGit(root, args, options),
		isFailure: (error): error is GitExecutionFailure => error instanceof GitCommandError,
	};
}
