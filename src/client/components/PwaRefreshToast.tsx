interface PwaRefreshToastProps {
	onDismiss: () => void;
	onUpdate: () => void;
	visible: boolean;
}

export function PwaRefreshToast({ onDismiss, onUpdate, visible }: PwaRefreshToastProps) {
	if (!visible) return null;
	return (
		<div className="toast update-toast">
			<span>An app update is ready.</span>
			<span>
				<button className="text-button" onClick={onDismiss} type="button">
					Later
				</button>
				<button className="text-button" onClick={onUpdate} type="button">
					Reload
				</button>
			</span>
		</div>
	);
}
