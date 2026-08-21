import {
	Copy,
	ExternalLink,
	Laptop,
	Plus,
	RefreshCw,
	ShieldCheck,
	Trash2,
} from "lucide-react-native";
import { ScrollView, View } from "react-native";

import type { RemoteBridgeCapability } from "../shared/contracts.ts";
import { NativeAppPairingPanel } from "./components/NativeAppPairingPanel.tsx";
import { SpeechInput } from "./components/speech";
import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	HStack,
	Icon,
	IconButton,
	Sheet,
	Spinner,
	Text,
	VStack,
} from "./components/ui";
import {
	type RemoteBridgeController,
	type RemoteBridgeDeviceItem,
	type RemoteBridgeLaunchCommand,
	useRemoteBridgeController,
} from "./features/nativeBridge";

interface RemoteBridgeSheetProps {
	capability: RemoteBridgeCapability;
	csrfToken: string;
	open: boolean;
	repositoryId: string;
	repositoryName: string;
	repositoryRoot: string;
	onClose(): void;
	onNotice(message: string): void;
}

function CommandBlock({ children }: { children: string }) {
	return (
		<Text
			className="rounded-lg border border-border bg-muted p-3 font-mono text-foreground"
			selectable
			size="xs"
		>
			{children}
		</Text>
	);
}

function LaunchCommand({
	command,
	onCopy,
	onOpen,
}: {
	command: RemoteBridgeLaunchCommand;
	onCopy(): void;
	onOpen?(): void;
}) {
	return (
		<VStack space="sm">
			<HStack align="center" justify="between" space="sm">
				<Text bold>{command.title}</Text>
				<HStack space="sm">
					{command.openUrl && onOpen ? (
						<Button
							accessibilityLabel={command.openLabel}
							leftIcon={ExternalLink}
							onPress={onOpen}
							size="sm"
							variant="outline"
						>
							Open
						</Button>
					) : null}
					<IconButton
						accessibilityLabel={command.copyLabel}
						icon={Copy}
						onPress={onCopy}
						size="sm"
						variant="ghost"
					/>
				</HStack>
			</HStack>
			<CommandBlock>{command.command}</CommandBlock>
		</VStack>
	);
}

function PairedMac({
	bridge,
	device,
}: {
	bridge: RemoteBridgeController;
	device: RemoteBridgeDeviceItem;
}) {
	const revoking = bridge.revokingId === device.id;
	return (
		<Card className="gap-4 bg-muted/30" size="sm">
			<HStack align="center" space="sm">
				<Icon as={Laptop} size={20} tone="muted" />
				<VStack className="min-w-0 flex-1" space="xs">
					<Text bold>{device.label}</Text>
					<Text size="xs" tone="muted">
						{device.lastUsedLabel}
					</Text>
				</VStack>
				{revoking ? (
					<Spinner accessibilityLabel={`Revoking ${device.label}`} />
				) : (
					<IconButton
						accessibilityLabel={`Revoke ${device.label}`}
						disabled={bridge.revokingId !== null}
						icon={Trash2}
						onPress={() => void bridge.revoke(device.raw)}
						size="sm"
						variant="destructive"
					/>
				)}
			</HStack>
			<VStack space="lg">
				{device.commands.map((command) => (
					<LaunchCommand
						command={command}
						key={command.id}
						onCopy={() => void bridge.copyCommand(command.command, command.copyNotice)}
						onOpen={
							command.openUrl ? () => void bridge.openUrl(command.openUrl as string) : undefined
						}
					/>
				))}
			</VStack>
		</Card>
	);
}

function BridgeTransportCard({ capability }: { capability: RemoteBridgeCapability }) {
	return (
		<Card className="flex-row items-start gap-3 border-primary/30 bg-primary/10" size="sm">
			<Icon as={ShieldCheck} size={20} tone="primary" />
			<VStack className="min-w-0 flex-1" space="xs">
				<Text bold>
					{capability.p2pEnabled ? "Direct WebRTC preferred" : "Protected WebSocket transport"}
				</Text>
				<Text size="sm" tone="muted">
					{capability.p2pEnabled
						? "The configured origin carries signaling and automatic fallback."
						: "IDE traffic stays on the Couchview origin WebSocket."}
				</Text>
			</VStack>
		</Card>
	);
}

function EnableBridgeCard({ bridge }: { bridge: RemoteBridgeController }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Enable on the Couchview Mac</CardTitle>
				<CardDescription>{bridge.capability.reason}</CardDescription>
			</CardHeader>
			<CardContent>
				<Text size="sm" tone="muted">
					Enable macOS Remote Login, stop this Couchview process, then relaunch it with these flags.
					Do not start a second server on the same port.
				</Text>
				<CommandBlock>{bridge.enableCommand}</CommandBlock>
				<Button
					className="self-start"
					leftIcon={Copy}
					onPress={() => void bridge.copyCommand(bridge.enableCommand, "Enable command copied")}
					variant="secondary"
				>
					Copy next-launch command
				</Button>
			</CardContent>
		</Card>
	);
}

function PairedMacsCard({ bridge }: { bridge: RemoteBridgeController }) {
	return (
		<Card>
			<CardHeader className="flex-row items-start gap-3">
				<VStack className="min-w-0 flex-1" space="xs">
					<CardTitle>Paired Macs</CardTitle>
					<CardDescription>
						Pair once, then use the same Mac with every repository registered here.
					</CardDescription>
				</VStack>
				<Button
					accessibilityLabel="Refresh paired Macs"
					leftIcon={RefreshCw}
					loading={bridge.loading}
					onPress={() => void bridge.refresh()}
					size="sm"
					variant="ghost"
				>
					Refresh
				</Button>
			</CardHeader>
			<CardContent>
				{bridge.deviceItems.map((device) => (
					<PairedMac bridge={bridge} device={device} key={device.id} />
				))}
				{!bridge.loading && bridge.deviceItems.length === 0 ? (
					<Text className="py-3 text-center" size="sm" tone="muted">
						No development Macs are paired yet.
					</Text>
				) : null}
			</CardContent>
		</Card>
	);
}

function pairingExpiry(expiresAt: string): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(expiresAt));
}

function PairMacCard({ bridge }: { bridge: RemoteBridgeController }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{bridge.deviceItems.length > 0 ? "Pair another Mac" : "Pair this Mac"}
				</CardTitle>
				<CardDescription>
					Generate a one-use command and run it once in Terminal on the development Mac. The pairing
					works for every registered repository.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<VStack space="sm">
					<Text bold size="sm">
						Device name
					</Text>
					<HStack className="flex-wrap" space="sm">
						<SpeechInput
							accessibilityLabel="Device name"
							autoCapitalize="words"
							autoCorrect={false}
							containerClassName="min-w-48 flex-1"
							maxLength={80}
							onChangeText={bridge.setLabel}
							onSubmitEditing={() => void bridge.createPairing()}
							returnKeyType="done"
							value={bridge.label}
						/>
						<Button
							disabled={!bridge.label.trim()}
							leftIcon={Plus}
							loading={bridge.creating}
							onPress={() => void bridge.createPairing()}
						>
							Generate
						</Button>
					</HStack>
				</VStack>
				{bridge.pairing ? (
					<VStack className="rounded-xl border border-border bg-muted/50 p-3" space="sm">
						<CommandBlock>{bridge.pairing.command}</CommandBlock>
						<Button
							className="self-start"
							leftIcon={Copy}
							onPress={() =>
								void bridge.copyCommand(bridge.pairing!.command, "Pairing command copied")
							}
							size="sm"
							variant="outline"
						>
							Copy command
						</Button>
						<Text size="xs" tone="muted">
							Expires {pairingExpiry(bridge.pairing.expiresAt)}. This panel refreshes when pairing
							finishes.
						</Text>
					</VStack>
				) : null}
			</CardContent>
		</Card>
	);
}

function AvailableBridgeContent({ bridge }: { bridge: RemoteBridgeController }) {
	return (
		<>
			<PairedMacsCard bridge={bridge} />
			<PairMacCard bridge={bridge} />
			<Text className="px-1" size="xs" tone="muted">
				The bridge exposes only the host Mac’s loopback SSH service. SSH authentication and host-key
				verification still apply; Couchview never stores your SSH private key. Revoking a Mac
				removes its access to every repository on this Couchview host.
			</Text>
		</>
	);
}

export function RemoteBridgeSheet({
	capability,
	csrfToken,
	open,
	repositoryId,
	repositoryName,
	repositoryRoot,
	onClose,
	onNotice,
}: RemoteBridgeSheetProps) {
	const bridge = useRemoteBridgeController({
		active: open,
		capability,
		csrfToken,
		onNotice,
		repositoryId,
		repositoryRoot,
	});
	return (
		<Sheet
			description={`${repositoryName} on this Mac`}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
			open={open}
			testID="remote-bridge-sheet"
			title="Native IDE"
		>
			<View accessibilityLabel="Native IDE setup" className="min-h-0 shrink" role="dialog">
				<ScrollView
					className="min-h-0 shrink"
					contentContainerClassName="gap-4 pb-2"
					keyboardShouldPersistTaps="handled"
				>
					<NativeAppPairingPanel csrfToken={csrfToken} onNotice={onNotice} open={open} />
					<BridgeTransportCard capability={capability} />
					{bridge.available ? (
						<AvailableBridgeContent bridge={bridge} />
					) : (
						<EnableBridgeCard bridge={bridge} />
					)}
					{bridge.error ? (
						<Text accessibilityRole="alert" selectable size="sm" tone="destructive">
							{bridge.error}
						</Text>
					) : null}
				</ScrollView>
			</View>
		</Sheet>
	);
}
