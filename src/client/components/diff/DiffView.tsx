import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ScrollView, Text, View } from "react-native";

import type { DiffViewerHandle, ViewerLineTarget } from "../../features/review/types.ts";
import type { DiffViewProps } from "./contract.ts";
import { reconstructUnifiedPatch } from "./engine/index.ts";
import { diffFontFamily, useDiffFontsLoaded } from "./fonts";
import { createDiffScene } from "./scene/createDiffScene.ts";
import type { DiffScene } from "./scene/types.ts";
import type { DiffSurfaceHandle, DiffSurfaceScrollCommand } from "./surface/contract.ts";
import { DiffRenderSessionStore } from "./surface/DiffRenderSession.ts";
import { LegendDiffSurface } from "./surface/LegendDiffSurface.tsx";
import { useDiffGeometry, useParsedDiff } from "./useDiffModel.ts";
import { useDiffTokens } from "./useDiffTokens.ts";

interface DiffViewport {
	height: number;
	scale: number;
	width: number;
}

type PendingNavigation =
	| { hunkIndex: number; type: "hunk" }
	| { target: ViewerLineTarget; type: "line" }
	| { type: "top" };

function navigationCommand(
	request: PendingNavigation,
	scene: DiffScene,
): Omit<DiffSurfaceScrollCommand, "generation"> | null {
	if (request.type === "top") return { behavior: "instant", x: 0, y: 0 };
	if (request.type === "hunk") {
		const y = scene.queries.offsetForHunk(request.hunkIndex, scene.viewport.height);
		return y === null ? null : { behavior: "smooth", y };
	}
	const y = scene.queries.offsetForLine(request.target, scene.viewport.height);
	if (y === null) return null;
	return {
		behavior: request.target.behavior === "instant" ? "instant" : "smooth",
		y,
	};
}

function fallbackView({
	fontFamily,
	fontSize,
	lineHeight,
	message,
	patch,
}: {
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
	message: string;
	patch: string;
}) {
	return (
		<View className="flex-1 bg-background" testID="pierre-code-view">
			<Text style={{ color: "#ffb4b8", padding: 10 }}>{message}</Text>
			<ScrollView contentContainerStyle={{ padding: 10 }} horizontal style={{ flex: 1 }}>
				<ScrollView>
					<Text selectable style={{ color: "#e7edf5", fontFamily, fontSize, lineHeight }}>
						{patch}
					</Text>
				</ScrollView>
			</ScrollView>
		</View>
	);
}

function fallbackPatch(diff: DiffViewProps["diff"]): string {
	try {
		return reconstructUnifiedPatch(diff);
	} catch {
		return diff.header.join("\n");
	}
}

export const DiffView = forwardRef<DiffViewerHandle, DiffViewProps>(function DiffView(
	{
		diff,
		fontFamily,
		fontSize,
		interactive = true,
		lineHeightAdjustment,
		lineNumbersVisible,
		lineWrapEnabled,
		onIdentifierClick,
		onVisibleLineChange,
		repositoryId,
		themeType = "dark",
		widthAdjustment,
	},
	ref,
) {
	const fontsReady = useDiffFontsLoaded();
	const resolvedFontFamily = useMemo(() => diffFontFamily(fontFamily), [fontFamily]);
	const [viewport, setViewport] = useState<DiffViewport>({ height: 0, scale: 1, width: 0 });
	const [failedGeneration, setFailedGeneration] = useState<string | null>(null);
	const parsed = useParsedDiff(diff);
	const geometry = useDiffGeometry({
		fontFamily: resolvedFontFamily,
		fontSize,
		lineHeightAdjustment,
		lineNumbersVisible,
		lineWrapEnabled,
		maxColumns: parsed.metrics.maxColumns,
		maxNumberDigits: parsed.metrics.maxNumberDigits,
		rows: parsed.rows,
		viewportWidth: viewport.width,
		widthAdjustment,
	});
	const tokenLayer = useDiffTokens({ diff, repositoryId, rows: parsed.rows, themeType });
	const contentIdentity = [repositoryId ?? "", diff.fileId, diff.contentRevision].join(":");
	const layoutRevision = [
		fontSize,
		lineHeightAdjustment,
		widthAdjustment,
		lineWrapEnabled,
		lineNumbersVisible,
		resolvedFontFamily,
		themeType,
		viewport.width,
		geometry.contentWidth,
		geometry.availableColumns,
	].join(":");
	const listKey = `${contentIdentity}:${layoutRevision}`;
	const scene = useMemo(
		() =>
			fontsReady && parsed.adaptedError === null
				? createDiffScene({
						diff,
						generation: listKey,
						geometry,
						layoutRevision,
						repositoryId: repositoryId ?? "",
						rows: parsed.rows,
						stage: "full",
						themeType,
						viewport,
					})
				: null,
		[
			diff,
			fontsReady,
			geometry,
			listKey,
			layoutRevision,
			parsed.adaptedError,
			parsed.rows,
			repositoryId,
			themeType,
			viewport,
		],
	);
	const [session] = useState(
		() => new DiffRenderSessionStore({ interactive, scene, tokens: tokenLayer }),
	);

	const surfaceRef = useRef<DiffSurfaceHandle>(null);
	const sceneRef = useRef(scene);
	const tokenLayerRef = useRef(tokenLayer);
	const readyGenerationRef = useRef<string | null>(null);
	const pendingNavigationRef = useRef<PendingNavigation | null>(null);
	const lastReportedRef = useRef<{ lineNumber: number; side: "old" | "new" } | null>(null);
	const onIdentifierClickRef = useRef(onIdentifierClick);
	const onVisibleLineChangeRef = useRef(onVisibleLineChange);
	sceneRef.current = scene;
	tokenLayerRef.current = tokenLayer;
	onIdentifierClickRef.current = onIdentifierClick;
	onVisibleLineChangeRef.current = onVisibleLineChange;

	const tryPendingNavigation = useCallback(() => {
		const request = pendingNavigationRef.current;
		const currentScene = sceneRef.current;
		if (!request || !currentScene) return;
		const command = navigationCommand(request, currentScene);
		if (command === null) {
			pendingNavigationRef.current = null;
			return;
		}
		if (readyGenerationRef.current !== currentScene.generation) return;
		pendingNavigationRef.current = null;
		surfaceRef.current?.scrollTo({ ...command, generation: currentScene.generation });
	}, []);

	const requestNavigation = useCallback(
		(request: PendingNavigation) => {
			pendingNavigationRef.current = request;
			tryPendingNavigation();
		},
		[tryPendingNavigation],
	);

	useImperativeHandle(
		ref,
		() => ({
			scrollToHunk: (hunkIndex) => requestNavigation({ hunkIndex, type: "hunk" }),
			scrollToLine: (target) => requestNavigation({ target, type: "line" }),
			scrollToTop: () => requestNavigation({ type: "top" }),
		}),
		[requestNavigation],
	);

	useLayoutEffect(() => {
		const previousGeneration = session.read().scene?.generation ?? null;
		const nextGeneration = scene?.generation ?? null;
		if (previousGeneration !== nextGeneration) readyGenerationRef.current = null;
		session.update({ interactive, scene, tokens: tokenLayer });
		tryPendingNavigation();
	}, [interactive, scene, session, tokenLayer, tryPendingNavigation]);

	useEffect(() => {
		lastReportedRef.current = null;
	}, [diff.contentRevision, diff.fileId]);
	useEffect(() => {
		setFailedGeneration(null);
	}, [scene?.generation]);

	const handleActivateAt = useCallback((generation: string, x: number, y: number) => {
		const currentScene = sceneRef.current;
		if (!currentScene || generation !== currentScene.generation) return;
		const identifier = currentScene.queries.identifierAt({ x, y }, tokenLayerRef.current.read());
		if (identifier) onIdentifierClickRef.current(identifier);
	}, []);
	const handleFailure = useCallback(
		(generation: string, _phase: "draw" | "prepare" | "scroll", recoverable: boolean) => {
			if (!recoverable && sceneRef.current?.generation === generation) {
				setFailedGeneration(generation);
			}
		},
		[],
	);
	const handleReady = useCallback(
		(generation: string) => {
			if (sceneRef.current?.generation !== generation) return;
			readyGenerationRef.current = generation;
			tryPendingNavigation();
		},
		[tryPendingNavigation],
	);
	const handleScrollSettled = useCallback((y: number) => {
		const currentScene = sceneRef.current;
		if (!currentScene) return;
		const visibleLine = currentScene.queries.visibleLineAt(y);
		if (!visibleLine) return;
		const last = lastReportedRef.current;
		if (last?.lineNumber === visibleLine.lineNumber && last.side === visibleLine.side) return;
		lastReportedRef.current = visibleLine;
		onVisibleLineChangeRef.current(visibleLine.lineNumber, visibleLine.side);
	}, []);
	const handleViewportChanged = useCallback((width: number, height: number, scale: number) => {
		setViewport((previous) => {
			const next = {
				height: Math.max(0, height),
				scale: Math.max(1, scale),
				width: Math.max(0, width),
			};
			return previous.height === next.height &&
				previous.scale === next.scale &&
				previous.width === next.width
				? previous
				: next;
		});
	}, []);
	const surfaceEvents = useMemo(
		() => ({
			activateAt: handleActivateAt,
			failure: handleFailure,
			ready: handleReady,
			scrollSettled: handleScrollSettled,
			viewportChanged: handleViewportChanged,
		}),
		[handleActivateAt, handleFailure, handleReady, handleScrollSettled, handleViewportChanged],
	);

	if (parsed.adaptedError !== null) {
		return fallbackView({
			fontFamily: resolvedFontFamily,
			fontSize,
			lineHeight: fontSize * 1.55 + lineHeightAdjustment,
			message: `Syntax rendering failed: ${parsed.adaptedError}. Showing plain text.`,
			patch: parsed.fallbackPatch,
		});
	}
	if (failedGeneration === scene?.generation) {
		return fallbackView({
			fontFamily: resolvedFontFamily,
			fontSize,
			lineHeight: geometry.layout.lineHeight,
			message: "Diff rendering failed. Showing plain text.",
			patch: fallbackPatch(diff),
		});
	}
	return <LegendDiffSurface events={surfaceEvents} ref={surfaceRef} session={session} />;
});
