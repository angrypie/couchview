import { Copy, X } from "lucide-react";
import type { FailureState } from "../lib/failures.ts";

interface FailureDetailsSheetProps {
	failure: FailureState | null;
	onClose: () => void;
	onCopy: () => void;
	open: boolean;
}

export function FailureDetailsSheet({ failure, onClose, onCopy, open }: FailureDetailsSheetProps) {
	if (!open || !failure) return null;

	return (
		<>
			<button
				aria-label="Close error details"
				className="modal-scrim"
				onClick={onClose}
				type="button"
			/>
			<section
				aria-label="Git error details"
				aria-modal="true"
				className="bottom-sheet diagnostic-sheet"
				role="dialog"
			>
				<span className="sheet-grabber" />
				<header className="sheet-header">
					<div>
						<h2 className="sheet-title">Error details</h2>
						<div className="repo-meta">
							{failure.context} · {failure.code}
						</div>
					</div>
					<button
						aria-label="Close error details"
						className="icon-button"
						onClick={onClose}
						type="button"
					>
						<X size={19} />
					</button>
				</header>
				<div className="diagnostic-content">
					<p className="diagnostic-message">{failure.message}</p>
					<dl className="diagnostic-grid">
						<div>
							<dt>HTTP status</dt>
							<dd>{failure.status ?? "Not available"}</dd>
						</div>
						<div>
							<dt>Error code</dt>
							<dd>{failure.code}</dd>
						</div>
						{failure.diagnostic && (
							<>
								<div>
									<dt>Diagnostic ID</dt>
									<dd>{failure.diagnostic.id}</dd>
								</div>
								<div>
									<dt>Git operation</dt>
									<dd>{failure.diagnostic.operation}</dd>
								</div>
								<div>
									<dt>Failure kind</dt>
									<dd>{failure.diagnostic.kind}</dd>
								</div>
								<div>
									<dt>Exit code</dt>
									<dd>{failure.diagnostic.exitCode ?? "Not available"}</dd>
								</div>
							</>
						)}
					</dl>
					{failure.diagnostic && (
						<>
							<h3 className="diagnostic-subtitle">Git output</h3>
							<pre className="diagnostic-output">
								{failure.diagnostic.stderr || "Git returned no stderr output."}
							</pre>
						</>
					)}
				</div>
				<footer className="sheet-footer diagnostic-actions">
					<button className="action-button secondary" onClick={onClose} type="button">
						Close
					</button>
					<button className="action-button" onClick={onCopy} type="button">
						<Copy size={15} /> Copy diagnostics
					</button>
				</footer>
			</section>
		</>
	);
}
