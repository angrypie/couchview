import { useCallback, useEffect, useMemo, useState } from "react";

import type { FileChange, RepositoryCatalogEntry } from "../../../shared/contracts.ts";
import { createFuzzyQuickPick } from "../../lib/fuzzyQuickPick.ts";
import type { QuickPickItem, QuickPickMode } from "./types.ts";
import { useProjectFileCatalog } from "./useProjectFileCatalog.ts";
import { useQuickPickerKeyboard } from "./useQuickPickerKeyboard";

const RESULT_LIMIT = 200;

interface UseQuickPickersOptions {
	currentPath: string | null;
	files: FileChange[];
	onRefreshChanges: () => Promise<unknown>;
	onRefreshRepositories: () => Promise<unknown>;
	onSelectFile: (path: string) => boolean;
	onSelectRepository: (repository: RepositoryCatalogEntry) => void;
	operationRevision: string;
	repositories: RepositoryCatalogEntry[];
	repositoryId: string | null;
}

function splitPath(path: string): { subtitle: string; title: string } {
	const separator = path.lastIndexOf("/");
	return separator < 0
		? { subtitle: "Project root", title: path }
		: { subtitle: path.slice(0, separator), title: path.slice(separator + 1) };
}

export function useQuickPickers({
	currentPath,
	files,
	onRefreshChanges,
	onRefreshRepositories,
	onSelectFile,
	onSelectRepository,
	operationRevision,
	repositories,
	repositoryId,
}: UseQuickPickersOptions) {
	const [mode, setMode] = useState<QuickPickMode | null>(null);
	const [query, setQueryState] = useState("");
	const [activeItemId, setActiveItemId] = useState<string | null>(null);
	const catalog = useProjectFileCatalog({
		enabled: mode === "files",
		onRefreshChanges,
		operationRevision,
		repositoryId,
	});

	const projectItems = useMemo<QuickPickItem[]>(() => {
		const available = repositories.filter((repository) => repository.available);
		const ordered = repositoryId
			? [
					...available.filter((repository) => repository.id === repositoryId),
					...available.filter((repository) => repository.id !== repositoryId),
				]
			: available;
		return ordered.map((repository) => ({
			id: `project:${repository.id}`,
			kind: "projects",
			searchText: `${repository.name} ${repository.root}`,
			subtitle: repository.root,
			title: repository.name,
		}));
	}, [repositories, repositoryId]);
	const catalogFileItems = useMemo<QuickPickItem[]>(
		() =>
			catalog.paths.map((path) => {
				const display = splitPath(path);
				return {
					id: `file:${path}`,
					kind: "files",
					searchText: path,
					subtitle: display.subtitle,
					title: display.title,
				};
			}),
		[catalog.paths],
	);
	const changedFileItems = useMemo<QuickPickItem[]>(
		() =>
			files.map((file) => {
				const path = file.path;
				const display = splitPath(path);
				return {
					id: `file:${path}`,
					kind: "files",
					searchText: path,
					subtitle: display.subtitle,
					title: display.title,
				};
			}),
		[files],
	);
	const fileItems = catalogFileItems.length > 0 ? catalogFileItems : changedFileItems;
	const currentItemId =
		mode === "projects"
			? repositoryId
				? `project:${repositoryId}`
				: null
			: currentPath
				? `file:${currentPath}`
				: null;
	const sourceItems = mode === "projects" ? projectItems : fileItems;
	const fuzzyScheme = mode === "projects" ? "default" : "path";
	const fuzzyIndex = useMemo(
		() =>
			createFuzzyQuickPick(sourceItems, (item) => item.searchText, {
				scheme: fuzzyScheme,
			}),
		[fuzzyScheme, sourceItems],
	);
	const items = useMemo(() => fuzzyIndex.search(query, RESULT_LIMIT), [fuzzyIndex, query]);
	const activeItemIndex = activeItemId ? items.findIndex((item) => item.id === activeItemId) : -1;
	const activeIndex = activeItemIndex >= 0 ? activeItemIndex : 0;

	useEffect(() => {
		if (activeItemId && activeItemIndex < 0) setActiveItemId(null);
	}, [activeItemId, activeItemIndex]);

	const close = useCallback(() => {
		setMode(null);
		setQueryState("");
		setActiveItemId(null);
	}, []);
	const openProjects = useCallback(() => {
		setQueryState("");
		setActiveItemId(null);
		setMode("projects");
		void onRefreshRepositories().catch(() => {});
	}, [onRefreshRepositories]);
	const openFiles = useCallback(() => {
		if (!repositoryId) return;
		setQueryState("");
		setActiveItemId(null);
		setMode("files");
	}, [repositoryId]);
	const setQuery = useCallback((nextQuery: string) => {
		setQueryState(nextQuery);
		setActiveItemId(null);
	}, []);
	const move = useCallback(
		(direction: -1 | 1) => {
			if (items.length === 0) return;
			setActiveItemId((currentId) => {
				const currentIndex = currentId ? items.findIndex((item) => item.id === currentId) : 0;
				const startIndex = currentIndex >= 0 ? currentIndex : 0;
				return items[(startIndex + direction + items.length) % items.length]!.id;
			});
		},
		[items],
	);
	const select = useCallback(
		(itemId: string) => {
			const item = items.find((candidate) => candidate.id === itemId);
			if (!item) return;
			if (item.kind === "projects") {
				const selected = repositories.find(
					(repository) => item.id === `project:${repository.id}` && repository.available,
				);
				if (!selected) return;
				close();
				onSelectRepository(selected);
				return;
			}
			const path = item.id.slice("file:".length);
			if (!onSelectFile(path)) return;
			close();
		},
		[close, items, onSelectFile, onSelectRepository, repositories],
	);
	const selectActive = useCallback(() => {
		const item = items[activeIndex];
		if (item) select(item.id);
	}, [activeIndex, items, select]);

	useQuickPickerKeyboard({ mode, onClose: close, onMove: move, onSelect: selectActive });

	return {
		activeIndex,
		catalogBusy: catalog.busy,
		catalogError: catalog.error,
		close,
		currentItemId,
		fileCount: fileItems.length,
		items,
		mode,
		move,
		openFiles,
		openProjects,
		query,
		retryCatalog: catalog.retry,
		select,
		selectActive,
		setQuery,
		truncated: catalog.truncated,
	};
}
