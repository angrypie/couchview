import { AlertTriangle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import type { FileChange, RepositorySummary } from "../../../shared/contracts.ts";
import type { GitWorkspaceStatus } from "../../../shared/git/index.ts";
import type { GitPendingAction } from "../../features/git/index.ts";
import { Button, Dialog, HStack, Icon, Switch, Text, VStack } from "../ui/index.ts";

interface GitActionConfirmationProps {
	busy: boolean;
	files: FileChange[];
	onCancel(): void;
	onConfirm(): void;
	onRequestStash(): void;
	pending: GitPendingAction | null;
	repository: RepositorySummary | null;
	status: GitWorkspaceStatus | null;
}

function actionCopy(pending: GitPendingAction, status: GitWorkspaceStatus | null) {
	switch (pending.action) {
		case "checkout":
			return {
				body: `Move this repository to “${pending.commit.subject}” in detached HEAD mode. You can return to the current branch afterward.`,
				confirm: "Checkout commit",
				title: `Checkout ${pending.commit.shortId}`,
			};
		case "return":
			return {
				body: `Checkout ${status?.previousBranch ?? "the previous branch"} and leave detached HEAD mode.`,
				confirm: "Return to branch",
				title: "Return to previous branch",
			};
		case "stash":
			return {
				body: "Save staged, unstaged, and untracked changes, then restore a clean working tree.",
				confirm: "Stash changes",
				title: "Stash repository changes",
			};
		case "restore-stash":
			return {
				body: "Apply and drop the latest stash. If Git reports conflicts, the stash will be kept.",
				confirm: "Restore stash",
				title: "Restore latest stash",
			};
		case "undo-last-commit":
			return {
				body: "Move the current branch back one commit while keeping all file changes locally and unstaged. A pushed commit would require a force push to rewrite remotely.",
				confirm: "Undo commit",
				title: "Undo last commit",
			};
		case "clean":
			return {
				body: `Permanently discard ${status?.trackedChangeCount ?? 0} tracked and ${status?.untrackedChangeCount ?? 0} untracked changes. Ignored files and nested repositories are preserved.`,
				confirm: "Clean repository",
				title: "Clean repository",
			};
	}
}

export function GitActionConfirmation({
	busy,
	files,
	onCancel,
	onConfirm,
	onRequestStash,
	pending,
	repository,
	status,
}: GitActionConfirmationProps) {
	const [acknowledged, setAcknowledged] = useState(false);
	useEffect(() => setAcknowledged(false), [pending]);
	if (!pending) return null;

	const copy = actionCopy(pending, status);
	const checkoutBlocked = ["checkout", "return"].includes(pending.action) && files.length > 0;
	const destructive = pending.action === "clean";
	const unbornClean = destructive && Boolean(repository?.unborn);
	const disabled = busy || checkoutBlocked || unbornClean || (destructive && !acknowledged);

	return (
		<Dialog
			dismissible={!busy}
			footer={
				<HStack justify="end" space="sm" wrap>
					<Button disabled={busy} onPress={onCancel} variant="secondary">
						Cancel
					</Button>
					{checkoutBlocked ? (
						<Button disabled={busy} onPress={onRequestStash} variant="outline">
							Stash changes…
						</Button>
					) : null}
					<Button
						disabled={disabled}
						loading={busy}
						onPress={onConfirm}
						variant={destructive ? "destructive" : "primary"}
					>
						{copy.confirm}
					</Button>
				</HStack>
			}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
			open
			title={copy.title}
		>
			<VStack space="md">
				<HStack align="start" space="sm">
					<Icon as={AlertTriangle} size={20} tone={destructive ? "destructive" : "warning"} />
					<Text
						className="min-w-0 flex-1 leading-5"
						tone={destructive ? "destructive" : "foreground"}
					>
						{copy.body}
					</Text>
				</HStack>

				{checkoutBlocked ? (
					<View className="rounded-xl border border-warning bg-warning/10 p-3">
						<Text className="font-semibold leading-5" tone="warning">
							This checkout is blocked because the repository has {files.length} changed{" "}
							{files.length === 1 ? "file" : "files"}. Stash or clean them first.
						</Text>
					</View>
				) : null}

				{destructive ? (
					<Switch
						disabled={busy || unbornClean}
						label="I understand these changes cannot be recovered by Couchview."
						onValueChange={setAcknowledged}
						value={acknowledged}
					/>
				) : null}

				{unbornClean ? (
					<View className="rounded-xl border border-warning bg-warning/10 p-3">
						<Text className="font-semibold" tone="warning">
							An unborn repository cannot be cleaned.
						</Text>
					</View>
				) : null}
			</VStack>
		</Dialog>
	);
}
