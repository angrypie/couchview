interface RepositoryDirectoryEntry {
	name: string;
	path: string;
}

export interface RepositoryDirectoryListing {
	directories: RepositoryDirectoryEntry[];
	parent: string | null;
	path: string;
	truncated: boolean;
}
