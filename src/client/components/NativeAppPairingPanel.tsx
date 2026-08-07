import { Copy, ExternalLink, Plus, RefreshCw, Smartphone, Trash2 } from "lucide-react-native";
import { useMemo } from "react";
import { Linking, Pressable, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { toQR } from "toqr";

import { useNativeClientPairing } from "../features/nativeClients/useNativeClientPairing.ts";
import { confirmAction } from "../lib/confirmAction";
import { Button, Card, Icon, IconButton, ListItem, Spinner, Text } from "./ui";

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
		<View
			accessibilityLabel="QR code for Couchview app pairing"
			accessibilityRole="image"
			className="size-48 overflow-hidden rounded-lg bg-white p-2"
		>
			<Svg height="100%" viewBox={`-4 -4 ${size + 8} ${size + 8}`} width="100%">
				<Rect fill="#ffffff" height={size + 8} width={size + 8} x={-4} y={-4} />
				<Path d={path} fill="#090d12" />
			</Svg>
		</View>
	);
}

export function NativeAppPairingPanel({ csrfToken, open, onNotice }: NativeAppPairingPanelProps) {
	const nativeClients = useNativeClientPairing({ active: open, csrfToken, onNotice });
	return (
		<Card className="gap-4">
			<View className="flex-row items-start gap-3">
				<View className="min-w-0 flex-1 gap-1">
					<Text bold>Couchview app</Text>
					<Text className="text-muted-foreground" size="sm">
						Pair an iPhone or iPad once, then use every repository on this server.
					</Text>
				</View>
				<IconButton
					accessibilityLabel="Refresh paired Couchview apps"
					disabled={nativeClients.loading}
					icon={RefreshCw}
					onPress={() => void nativeClients.refresh()}
				/>
			</View>
			<View className="gap-1">
				{nativeClients.devices.map((device) => (
					<ListItem
						key={device.id}
						leading={<Icon as={Smartphone} size={18} tone="muted" />}
						subtitle={formatDeviceTime(device.lastUsedAt)}
						title={device.label}
						trailing={
							nativeClients.revokingId === device.id ? (
								<Spinner />
							) : (
								<IconButton
									accessibilityLabel={`Revoke app access for ${device.label}`}
									disabled={nativeClients.revokingId !== null}
									icon={Trash2}
									onPress={() => {
										void confirmAction(`Revoke Couchview app access for ${device.label}?`).then(
											(confirmed) => {
												if (confirmed) return nativeClients.revoke(device);
											},
										);
									}}
									variant="ghost"
								/>
							)
						}
					/>
				))}
				{!nativeClients.loading && nativeClients.devices.length === 0 ? (
					<Text className="py-3 text-center text-muted-foreground" size="sm">
						No Couchview apps are paired yet.
					</Text>
				) : null}
			</View>
			<Button
				disabled={nativeClients.creating}
				leftIcon={Plus}
				loading={nativeClients.creating}
				onPress={nativeClients.createPairing}
				variant="secondary"
			>
				Generate app pairing
			</Button>
			{nativeClients.pairing ? (
				<View className="items-center gap-3 rounded-xl bg-muted p-3 sm:flex-row sm:items-start">
					<PairingQrCode value={nativeClients.pairing.deepLink} />
					<View className="min-w-0 flex-1 gap-3">
						<Pressable onPress={() => void nativeClients.copyPairingLink()}>
							<Text className="font-mono text-primary" selectable size="xs">
								{nativeClients.pairing.deepLink}
							</Text>
						</Pressable>
						<View className="flex-row flex-wrap gap-2">
							<Button
								leftIcon={Copy}
								onPress={() => void nativeClients.copyPairingLink()}
								size="sm"
								variant="outline"
							>
								Copy link
							</Button>
							<Button
								leftIcon={ExternalLink}
								onPress={() => void Linking.openURL(nativeClients.pairing!.deepLink)}
								size="sm"
								variant="outline"
							>
								Open app
							</Button>
						</View>
						<Text className="text-muted-foreground" size="xs">
							Code {nativeClients.pairing.code} · expires{" "}
							{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
								new Date(nativeClients.pairing.expiresAt),
							)}
						</Text>
					</View>
				</View>
			) : null}
			{nativeClients.error ? (
				<Text accessibilityRole="alert" className="text-destructive" size="sm">
					{nativeClients.error}
				</Text>
			) : null}
		</Card>
	);
}
