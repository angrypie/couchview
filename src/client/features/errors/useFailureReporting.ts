import { useCallback, useState } from "react";
import { copyToClipboard } from "../../lib/clipboard.ts";
import {
	type FailureState,
	failureOf,
	formatFailureDiagnostics,
	messageOf,
} from "../../lib/failures.ts";

interface UseFailureReportingOptions {
	showToast: (message: string, undo?: undefined, details?: boolean) => void;
}

export function useFailureReporting({ showToast }: UseFailureReportingOptions) {
	const [failure, setFailure] = useState<FailureState | null>(null);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const clearFailure = useCallback(() => setFailure(null), []);

	const reportFailure = useCallback(
		(error: unknown, context: string, toastMessage = true): FailureState => {
			const next = failureOf(error, context);
			setFailure(next);
			setDetailsOpen(false);
			if (toastMessage) showToast(next.message, undefined, true);
			return next;
		},
		[showToast],
	);

	const copyDiagnostics = useCallback(async () => {
		if (!failure) return;
		try {
			await copyToClipboard(formatFailureDiagnostics(failure));
			showToast("Diagnostics copied");
		} catch (error) {
			showToast(messageOf(error));
		}
	}, [failure, showToast]);

	return {
		clearFailure,
		copyDiagnostics,
		detailsOpen,
		failure,
		reportFailure,
		setDetailsOpen,
	};
}
