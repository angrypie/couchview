import { stat } from "node:fs/promises";

import type { RepositoryCatalogEntry } from "../shared/contracts.ts";
import { StateDatabase, type StoredRepository } from "./database.ts";
import { HttpError } from "./errors.ts";
import { GitRepository } from "./repository.ts";

type RepositoryChangeListener = (operationRevision: string) => void;

async function repositoryAvailable(repository: StoredRepository): Promise<boolean> {
	const [root, gitDirectory] = await Promise.all([
		stat(repository.root).catch(() => null),
		stat(repository.gitDirectory).catch(() => null),
	]);
	return Boolean(root?.isDirectory() && gitDirectory?.isDirectory());
}

async function catalogEntry(repository: StoredRepository): Promise<RepositoryCatalogEntry> {
	return {
		id: repository.id,
		name: repository.name,
		root: repository.root,
		available: await repositoryAvailable(repository),
		addedAt: repository.addedAt,
	};
}

export class RepositoryManager {
	private readonly openRepositories = new Map<string, GitRepository>();
	private readonly listeners = new Map<string, Set<RepositoryChangeListener>>();

	constructor(readonly database: StateDatabase) {}

	async register(
		candidate: string,
	): Promise<{ repository: RepositoryCatalogEntry; added: boolean }> {
		const opened = await GitRepository.open(candidate, this.database);
		const repositoryId = opened.id;
		const added = opened.catalogAdded;
		opened.close();
		const stored = this.database.repository(repositoryId);
		if (!stored) throw new Error("Registered repository is missing from the catalog");
		return {
			repository: await catalogEntry(stored),
			added,
		};
	}

	async list(): Promise<RepositoryCatalogEntry[]> {
		return Promise.all(this.database.repositories().map(catalogEntry));
	}

	async get(id: string): Promise<GitRepository> {
		const existing = this.openRepositories.get(id);
		const stored = this.database.repository(id);
		if (!stored) {
			existing?.close();
			this.openRepositories.delete(id);
			this.listeners.delete(id);
			throw new HttpError(404, "repository_not_found", "Repository is not registered");
		}
		if (!(await repositoryAvailable(stored))) {
			existing?.close();
			this.openRepositories.delete(id);
			this.listeners.delete(id);
			throw new HttpError(
				409,
				"repository_unavailable",
				"The saved repository is no longer available at its recorded path",
			);
		}
		if (existing) return existing;
		let repository: GitRepository;
		try {
			repository = await GitRepository.open(stored.root, this.database);
		} catch {
			throw new HttpError(
				409,
				"repository_unavailable",
				"The saved repository is no longer available at its recorded path",
			);
		}
		if (repository.id !== id) {
			repository.close();
			throw new HttpError(
				409,
				"repository_changed",
				"The saved path now points to a different Git repository",
			);
		}
		this.openRepositories.set(id, repository);
		this.startWatching(repository);
		return repository;
	}

	subscribe(id: string, listener: RepositoryChangeListener): () => void {
		const listeners = this.listeners.get(id) ?? new Set<RepositoryChangeListener>();
		listeners.add(listener);
		this.listeners.set(id, listeners);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) this.listeners.delete(id);
		};
	}

	private startWatching(repository: GitRepository): void {
		repository.startWatching((operationRevision) => {
			for (const listener of this.listeners.get(repository.id) ?? []) {
				listener(operationRevision);
			}
		});
	}

	forget(id: string): void {
		const repository = this.openRepositories.get(id);
		repository?.close();
		this.openRepositories.delete(id);
		this.listeners.delete(id);
		if (!this.database.forgetRepository(id)) {
			throw new HttpError(404, "repository_not_found", "Repository is not registered");
		}
	}

	close(): void {
		for (const repository of this.openRepositories.values()) repository.close();
		this.openRepositories.clear();
		this.listeners.clear();
	}
}
