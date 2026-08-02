import { useCallback, useEffect, useRef, useState } from "react";
import type { UndoReview } from "../review/useReviewStatus.ts";

export interface ToastState {
	id: number;
	message: string;
	undo?: UndoReview;
	details?: boolean;
}

export function useToastNotifications() {
	const [toast, setToast] = useState<ToastState | null>(null);
	const counter = useRef(0);

	const showToast = useCallback((message: string, undo?: UndoReview, details = false) => {
		counter.current += 1;
		setToast({ id: counter.current, message, undo, details });
	}, []);
	const dismissToast = useCallback(() => setToast(null), []);

	useEffect(() => {
		if (!toast) return;
		const timeout = window.setTimeout(dismissToast, toast.details ? 12_000 : 5_200);
		return () => window.clearTimeout(timeout);
	}, [dismissToast, toast]);

	return {
		dismissToast,
		setToast,
		showToast,
		toast,
	};
}
