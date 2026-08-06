import { AlertTriangle, LoaderCircle, LogIn, RefreshCw, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { API_ROUTES } from "../../shared/contracts.ts";
import type { AppPhase } from "../features/repositories/useRepositoryWorkspace.ts";
import { isNativeProductSurface, NATIVE_SERVER_MANAGER_URL } from "../lib/nativeProductSurface.ts";

interface ApplicationStateViewProps {
	appCacheResetBusy: boolean;
	commandUi: ReactNode;
	compactLandscape: boolean;
	loadError: string;
	loadErrorCode: string;
	onLoad: () => Promise<void>;
	onResetAppCache: () => Promise<void>;
	phase: AppPhase;
}

export function ApplicationStateView({
	appCacheResetBusy,
	commandUi,
	compactLandscape,
	loadError,
	loadErrorCode,
	onLoad,
	onResetAppCache,
	phase,
}: ApplicationStateViewProps) {
	if (phase === "loading") {
		return (
			<>
				<main className={`app-shell ${compactLandscape ? "compact-landscape" : ""}`}>
					<div className="loading-state" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
						<LoaderCircle className="state-icon spinner" size={30} />
						<h1 className="state-title">Opening repository…</h1>
						<p className="state-copy">Reading changed files and restoring settings.</p>
					</div>
				</main>
				{commandUi}
			</>
		);
	}
	if (phase !== "error") return null;

	const authenticationRequired = loadErrorCode === "authentication_required";
	const authenticationRefreshFailed = loadErrorCode === "authentication_refresh_failed";
	const disconnected = loadErrorCode === "disconnected";
	const nativeProductSurface = isNativeProductSurface();
	const repositoryId = new URL(window.location.href).searchParams.get("repo");
	const accessRefresh = new URL(API_ROUTES.accessRefresh, window.location.origin);
	if (repositoryId) accessRefresh.searchParams.set("repo", repositoryId);

	return (
		<main className={`app-shell ${compactLandscape ? "compact-landscape" : ""}`}>
			<div className="error-state" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
				<AlertTriangle className="state-icon" size={32} />
				<h1 className="state-title">
					{authenticationRefreshFailed
						? "Sign-in didn’t complete"
						: authenticationRequired
							? "Sign-in expired"
							: disconnected
								? "Couchview is unavailable"
								: "Couldn’t open Couchview"}
				</h1>
				<p className="state-copy">
					{authenticationRefreshFailed
						? "Cloudflare returned to Couchview, but this browser still does not have a usable Access session."
						: authenticationRequired
							? "Sign in again to continue using Couchview."
							: loadError}
				</p>
				<div className="state-actions">
					{nativeProductSurface ? (
						<>
							<button className="action-button" onClick={() => void onLoad()} type="button">
								<RefreshCw size={16} /> Retry
							</button>
							<a className="action-button secondary" href={NATIVE_SERVER_MANAGER_URL}>
								Manage servers
							</a>
						</>
					) : authenticationRefreshFailed ? (
						<>
							<a className="action-button" href={API_ROUTES.accessLogout}>
								<RotateCcw size={16} /> Reset Cloudflare sign-in
							</a>
							<a
								className="action-button secondary"
								href={`${accessRefresh.pathname}${accessRefresh.search}`}
							>
								<LogIn size={16} /> Try sign-in again
							</a>
						</>
					) : authenticationRequired ? (
						<>
							<a
								className="action-button"
								href={`${accessRefresh.pathname}${accessRefresh.search}`}
							>
								<LogIn size={16} /> Sign in again
							</a>
							<button
								className="action-button secondary"
								onClick={() => void onLoad()}
								type="button"
							>
								<RefreshCw size={16} /> Retry
							</button>
						</>
					) : (
						<>
							<button className="action-button" onClick={() => void onLoad()} type="button">
								<RefreshCw size={16} /> Retry
							</button>
							{disconnected && (
								<a
									className="action-button secondary"
									href={`${accessRefresh.pathname}${accessRefresh.search}`}
								>
									<LogIn size={16} /> Sign in again
								</a>
							)}
							{disconnected && (
								<button
									className="action-button secondary"
									disabled={appCacheResetBusy}
									onClick={() => void onResetAppCache()}
									type="button"
								>
									{appCacheResetBusy ? (
										<LoaderCircle className="spinner" size={16} />
									) : (
										<RotateCcw size={16} />
									)}
									Reset app cache
								</button>
							)}
						</>
					)}
				</div>
				{authenticationRefreshFailed && (
					<p className="state-help">
						Reset signs this browser out of every Cloudflare Access app. Return to Couchview and
						sign in again.
					</p>
				)}
			</div>
		</main>
	);
}
