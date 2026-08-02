import { useMemo, useState } from "react";
import type { ChangeFile } from "../../../shared/contracts.ts";
import type { ReviewFilter, StageFilter } from "./types.ts";

export function useChangedFileFilters(files: ChangeFile[]) {
	const [fileQuery, setFileQuery] = useState("");
	const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
	const [stageFilter, setStageFilter] = useState<StageFilter>("all");

	const filteredFiles = useMemo(() => {
		const normalizedQuery = fileQuery.trim().toLocaleLowerCase();
		return files.filter((file) => {
			if (
				normalizedQuery &&
				!file.path.toLocaleLowerCase().includes(normalizedQuery) &&
				!file.previousPath?.toLocaleLowerCase().includes(normalizedQuery)
			) {
				return false;
			}
			if (reviewFilter === "reviewed" && !file.reviewed) return false;
			if (reviewFilter === "unreviewed" && file.reviewed) return false;
			if (stageFilter === "staged" && !file.staged) return false;
			if (stageFilter === "unstaged" && !file.unstaged) return false;
			return true;
		});
	}, [fileQuery, files, reviewFilter, stageFilter]);

	const reviewedCount = files.filter((file) => file.reviewed).length;
	const stagedCount = files.filter((file) => file.staged).length;
	const changeTotals = files.reduce(
		(totals, file) => ({
			additions: totals.additions + (file.additions ?? 0),
			deletions: totals.deletions + (file.deletions ?? 0),
		}),
		{ additions: 0, deletions: 0 },
	);
	const stageableFiles = files.filter((file) => !file.staged || file.unstaged);
	const stageableReviewedFiles = stageableFiles.filter((file) => file.reviewed);

	return {
		changeTotals,
		fileQuery,
		filteredFiles,
		reviewFilter,
		reviewedCount,
		setFileQuery,
		setReviewFilter,
		setStageFilter,
		stageFilter,
		stageableCount: stageableFiles.length,
		stageableReviewedCount: stageableReviewedFiles.length,
		stagedCount,
	};
}
