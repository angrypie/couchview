const repositoryGitApiPath = (repositoryId: string) =>
	`/api/repositories/${encodeURIComponent(repositoryId)}/git`;

export const GIT_API_ROUTES = {
	history: (repositoryId: string) => `${repositoryGitApiPath(repositoryId)}/history`,
	historyCommit: (repositoryId: string, commit: string) =>
		`${repositoryGitApiPath(repositoryId)}/history/${encodeURIComponent(commit)}`,
	historyDiff: (repositoryId: string, commit: string, fileId: string) =>
		`${repositoryGitApiPath(repositoryId)}/history/${encodeURIComponent(commit)}/files/${encodeURIComponent(fileId)}/diff`,
	actions: (repositoryId: string) => `${repositoryGitApiPath(repositoryId)}/actions`,
} as const;
