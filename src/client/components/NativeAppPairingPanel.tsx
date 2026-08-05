import {
	Copy,
	ExternalLink,
	LoaderCircle,
	Plus,
	RefreshCw,
	Smartphone,
	Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { toQR } from "toqr";

import { useNativeClientPairing } from "../features/nativeClients/useNativeClientPairing.ts";

interface NativeAppPairingPanelProps {
	csrfToken: string;
	open: boolean;
	onNotice(message: string): void;
}

function formatDeviceTime(value: string | null): string {
	if (!value) return "Never connected";
	return `Last used ${new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value))}`;
}

function PairingQrCode({ value }: { value: string }) {
	const { modules, path, size } = useMemo(() => {
		const nextModules = toQR(value);
		const nextSize = Math.sqrt(nextModules.length);
		let nextPath = "";
		for (let index = 0; index < nextModules.length; index += 1) {
			if (!nextModules[index]) continue;
			const x = index % nextSize;
			const y = Math.floor(index / nextSize);
			nextPath += `M${x} ${y}h1v1h-1z`;
		}
		return { modules: nextModules, path: nextPath, size: nextSize };
	}, [value]);
	if (!modules.length) return null;
	return (
		<svg
			aria-label="QR code for Couchview app pairing"
			className="native-app-pairing-qr"
			role="img"
			viewBox={`-4 -4 ${size + 8} ${size + 8}`}
		>
			<rect fill="#ffffff" height={size + 8} width={size + 8} x={-4} y={-4} />
			<path d={path} fill="#090d12" />
		</svg>
	);
}

export function NativeAppPairingPanel({ csrfToken, open, onNotice }: NativeAppPairingPanelProps) {
	const nativeClients = useNativeClientPairing({ active: open, csrfToken, onNotice });

	return (
		<section className="remote-bridge-card native-app-card">
			<div className="remote-bridge-card-heading">
				<div>
					<h3>Couchview app</h3>
					<p>Pair an iPhone or iPad once, then use every repository on this server.</p>
				</div>
				<button
					aria-label="Refresh paired Couchview apps"
					className="icon-button"
					disabled={nativeClients.loading}
					onClick={() => void nativeClients.refresh()}
					type="button"
				>
					<RefreshCw className={nativeClients.loading ? "spinner" : ""} size={16} />
				</button>
			</div>
			<div className="remote-bridge-devices">
				{nativeClients.devices.map((device) => (
					<div className="remote-bridge-device" key={device.id}>
						<Smartphone className="remote-bridge-device-icon" size={18} />
						<div className="remote-bridge-device-meta">
							<strong>{device.label}</strong>
							<span>{formatDeviceTime(device.lastUsedAt)}</span>
						</div>
						<button
							aria-label={`Revoke app access for ${device.label}`}
							className="icon-button remote-bridge-revoke"
							disabled={nativeClients.revokingId !== null}
							onClick={() => {
								if (window.confirm(`Revoke Couchview app access for ${device.label}?`)) {
									void nativeClients.revoke(device);
								}
							}}
							type="button"
						>
							{nativeClients.revokingId === device.id ? (
								<LoaderCircle className="spinner" size={16} />
							) : (
								<Trash2 size={16} />
							)}
						</button>
					</div>
				))}
				{!nativeClients.loading && nativeClients.devices.length === 0 ? (
					<p className="remote-bridge-empty">No Couchview apps are paired yet.</p>
				) : null}
			</div>
			<button
				className="action-button secondary"
				disabled={nativeClients.creating}
				onClick={nativeClients.createPairing}
				type="button"
			>
				{nativeClients.creating ? (
					<LoaderCircle className="spinner" size={15} />
				) : (
					<Plus size={15} />
				)}
				Generate app pairing
			</button>
			{nativeClients.pairing ? (
				<div className="native-app-pairing">
					<PairingQrCode value={nativeClients.pairing.deepLink} />
					<div>
						<pre className="remote-bridge-command">{nativeClients.pairing.deepLink}</pre>
						<div className="native-app-pairing-actions">
							<button
								className="action-button secondary"
								onClick={() => void nativeClients.copyPairingLink()}
								type="button"
							>
								<Copy size={15} /> Copy link
							</button>
							<a className="remote-bridge-open" href={nativeClients.pairing.deepLink}>
								<ExternalLink size={13} /> Open app
							</a>
						</div>
						<span>
							Code {nativeClients.pairing.code} · expires{" "}
							{new Intl.DateTimeFormat(undefined, {
								hour: "numeric",
								minute: "2-digit",
							}).format(new Date(nativeClients.pairing.expiresAt))}
						</span>
					</div>
				</div>
			) : null}
			{nativeClients.error ? (
				<div className="remote-bridge-error" role="alert">
					{nativeClients.error}
				</div>
			) : null}
		</section>
	);
}
