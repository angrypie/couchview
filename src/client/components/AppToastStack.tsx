import type { ToastState } from "../features/notifications/useToastNotifications.ts";
import type { UndoReview } from "../features/review/useReviewStatus.ts";
import { PwaRefreshToast } from "./PwaRefreshToast.tsx";

interface AppToastStackProps {
	canInstall: boolean;
	failureAvailable: boolean;
	iosInstallHint: boolean;
	onDismissInstall: () => void;
	onDismissRefresh: () => void;
	onOpenFailure: () => void;
	onUndo: (undo: UndoReview) => void;
	onUpdate: () => void;
	onInstall: () => void;
	refreshAvailable: boolean;
	toast: ToastState | null;
}

export function AppToastStack({
	canInstall,
	failureAvailable,
	iosInstallHint,
	onDismissInstall,
	onDismissRefresh,
	onInstall,
	onOpenFailure,
	onUndo,
	onUpdate,
	refreshAvailable,
	toast,
}: AppToastStackProps) {
	const undo = toast?.undo;
	return (
		<div className="toast-stack" aria-live="polite">
			{toast && (
				<div className="toast" key={toast.id}>
					<span>{toast.message}</span>
					{undo && (
						<button className="text-button" onClick={() => onUndo(undo)} type="button">
							Undo
						</button>
					)}
					{toast.details && failureAvailable && (
						<button className="text-button" onClick={onOpenFailure} type="button">
							Details
						</button>
					)}
				</div>
			)}
			<PwaRefreshToast
				onDismiss={onDismissRefresh}
				onUpdate={onUpdate}
				visible={refreshAvailable}
			/>
			{canInstall && (
				<div className="toast">
					<span>Install Couchview for full-screen access.</span>
					<span>
						<button className="text-button" onClick={onDismissInstall} type="button">
							Not now
						</button>
						<button className="text-button" onClick={onInstall} type="button">
							Install
						</button>
					</span>
				</div>
			)}
			{iosInstallHint && !canInstall && (
				<div className="toast">
					<span>Install via Share → Add to Home Screen.</span>
					<button className="text-button" onClick={onDismissInstall} type="button">
						Dismiss
					</button>
				</div>
			)}
		</div>
	);
}
