import {
	LegendList,
	type LegendListRef,
	type LegendListRenderItemProps,
} from "@legendapp/list/react-native";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import {
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	PixelRatio,
	Platform,
	ScrollView,
	View,
} from "react-native";
import { DiffRowView } from "../DiffRowView";
import { injectDiffViewerStyles } from "../diffWebStyles.ts";
import type { DiffScene, DiffSceneLayout, DiffSceneRow } from "../scene/types.ts";
import type { DiffRenderSession, DiffSurfaceHandle, DiffSurfaceProps } from "./contract.ts";

const SCROLL_SETTLE_DELAY_MS = 120;

interface SurfaceSnapshot {
	interactive: boolean;
	scene: DiffScene | null;
}

interface LegendDiffRowProps {
	generation: string;
	interactive: boolean;
	layout: DiffSceneLayout;
	onIdentifierPress(rowIndex: number, column: number): void;
	row: DiffSceneRow;
	rowIndex: number;
	session: DiffRenderSession;
}

function useSurfaceSnapshot(session: DiffRenderSession): SurfaceSnapshot {
	const cachedRef = useRef<SurfaceSnapshot | null>(null);
	const read = useCallback(() => {
		const current = session.read();
		const cached = cachedRef.current;
		if (cached?.interactive === current.interactive && cached.scene === current.scene)
			return cached;
		const next = { interactive: current.interactive, scene: current.scene };
		cachedRef.current = next;
		return next;
	}, [session]);
	return useSyncExternalStore(session.subscribe, read, read);
}

function useRowTokens({ generation, row, rowIndex, session }: LegendDiffRowProps) {
	const read = useCallback(() => {
		const current = session.read();
		if (current.scene?.generation !== generation || current.scene.rows[rowIndex]?.id !== row.id) {
			return null;
		}
		return current.tokens.runsAt(rowIndex);
	}, [generation, row.id, rowIndex, session]);
	return useSyncExternalStore(session.subscribe, read, read);
}

function LegendDiffRow(props: LegendDiffRowProps) {
	const tokens = useRowTokens(props);
	return (
		<DiffRowView
			interactive={props.interactive}
			layout={props.layout}
			onIdentifierPress={props.onIdentifierPress}
			row={props.row}
			rowIndex={props.rowIndex}
			tokens={tokens}
		/>
	);
}

function sceneDataKey(scene: DiffScene): string {
	const { contentRevision, fileId, layoutRevision, repositoryId } = scene.identity;
	return `${repositoryId}:${fileId}:${contentRevision}:${layoutRevision}`;
}

function fixedRowSize(row: DiffSceneRow): number {
	return row.height;
}

function rowKey(row: DiffSceneRow): string {
	return row.id;
}

function rowType(row: DiffSceneRow): DiffSceneRow["kind"] {
	return row.kind;
}

function DiffSurfaceStatus({ session }: { session: DiffRenderSession }) {
	const snapshot = useSyncExternalStore(session.subscribe, session.read, session.read);
	if (Platform.OS !== "web") return null;
	const webProps = {
		dataSet: {
			generation: snapshot.cursor.generation,
			logicalRowCount: String(snapshot.scene?.rows.length ?? 0),
			tokenComplete: String(snapshot.tokens.complete),
			tokenRevision: String(snapshot.cursor.tokenRevision),
		},
		testID: "diff-surface-status",
	} as Record<string, unknown>;
	return <View {...webProps} style={{ display: "none" }} />;
}

export const LegendDiffSurface = forwardRef<DiffSurfaceHandle, DiffSurfaceProps>(
	function LegendDiffSurface({ events, session }, ref) {
		const snapshot = useSurfaceSnapshot(session);
		const scene = snapshot.scene;
		const sceneRef = useRef(scene);
		const horizontalRef = useRef<ScrollView>(null);
		const listRef = useRef<LegendListRef>(null);
		const offsetRef = useRef({ x: 0, y: 0 });
		const settleDeadlineRef = useRef(0);
		const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		sceneRef.current = scene;
		useEffect(injectDiffViewerStyles, []);

		const clearSettleTimer = useCallback(() => {
			settleDeadlineRef.current = 0;
			if (settleTimerRef.current === null) return;
			clearTimeout(settleTimerRef.current);
			settleTimerRef.current = null;
		}, []);
		const reportSettled = useCallback(
			(y = offsetRef.current.y) => {
				clearSettleTimer();
				offsetRef.current.y = y;
				events.scrollSettled(y);
			},
			[clearSettleTimer, events],
		);
		const checkSettled = useCallback(() => {
			settleTimerRef.current = null;
			const remaining = settleDeadlineRef.current - Date.now();
			if (remaining <= 0) {
				reportSettled();
				return;
			}
			settleTimerRef.current = setTimeout(checkSettled, remaining);
		}, [reportSettled]);
		const scheduleSettled = useCallback(() => {
			settleDeadlineRef.current = Date.now() + SCROLL_SETTLE_DELAY_MS;
			if (settleTimerRef.current !== null) return;
			settleTimerRef.current = setTimeout(checkSettled, SCROLL_SETTLE_DELAY_MS);
		}, [checkSettled]);

		useEffect(() => clearSettleTimer, [clearSettleTimer]);
		useImperativeHandle(
			ref,
			() => ({
				scrollTo: (command) => {
					if (sceneRef.current?.generation !== command.generation) return;
					clearSettleTimer();
					const x = command.x ?? offsetRef.current.x;
					offsetRef.current = { x, y: command.y };
					horizontalRef.current?.scrollTo({
						animated: command.behavior === "smooth",
						x,
					});
					const list = listRef.current;
					if (!list) {
						events.failure(command.generation, "scroll", true);
						return;
					}
					void list
						.scrollToOffset({
							animated: command.behavior === "smooth",
							offset: command.y,
						})
						.then(() => {
							if (sceneRef.current?.generation === command.generation) {
								reportSettled(command.y);
							}
						})
						.catch(() => {
							if (sceneRef.current?.generation === command.generation) {
								events.failure(command.generation, "scroll", true);
							}
						});
				},
			}),
			[clearSettleTimer, events, reportSettled],
		);

		const handleLayout = useCallback(
			(event: LayoutChangeEvent) => {
				const { height, width } = event.nativeEvent.layout;
				events.viewportChanged(width, height, PixelRatio.get());
			},
			[events],
		);
		const handleFirstVisibleItemChanged = useCallback(
			({ item }: { item: DiffSceneRow }) => {
				offsetRef.current.y = item.top;
				scheduleSettled();
			},
			[scheduleSettled],
		);
		const handleVerticalScroll = useCallback(
			(event: NativeSyntheticEvent<NativeScrollEvent>) => {
				offsetRef.current.y = event.nativeEvent.contentOffset.y;
				scheduleSettled();
			},
			[scheduleSettled],
		);
		const handleVerticalEnd = useCallback(
			(event: NativeSyntheticEvent<NativeScrollEvent>) => {
				reportSettled(event.nativeEvent.contentOffset.y);
			},
			[reportSettled],
		);
		const handleVerticalDragEnd = useCallback(
			(event: NativeSyntheticEvent<NativeScrollEvent>) => {
				const velocity = event.nativeEvent.velocity;
				if (!velocity?.x && !velocity?.y) handleVerticalEnd(event);
			},
			[handleVerticalEnd],
		);
		const handleHorizontalScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
			offsetRef.current.x = event.nativeEvent.contentOffset.x;
		}, []);
		const handleHorizontalEnd = useCallback(() => {
			scheduleSettled();
		}, [scheduleSettled]);
		const handleIdentifierPress = useCallback(
			(rowIndex: number, column: number) => {
				const current = sceneRef.current;
				if (!current || !snapshot.interactive) return;
				const point = current.queries.pointForColumn(rowIndex, column);
				if (point) events.activateAt(current.generation, point.x, point.y);
			},
			[events, snapshot.interactive],
		);
		const handleLoad = useCallback(() => {
			const current = sceneRef.current;
			if (current) events.ready(current.generation);
		}, [events]);
		const renderItem = useCallback(
			({ index, item }: LegendListRenderItemProps<DiffSceneRow>) =>
				scene ? (
					<LegendDiffRow
						generation={scene.generation}
						interactive={snapshot.interactive}
						layout={scene.layout}
						onIdentifierPress={handleIdentifierPress}
						row={item}
						rowIndex={index}
						session={session}
					/>
				) : null,
			[handleIdentifierPress, scene, session, snapshot.interactive],
		);
		const dataKey = useMemo(() => (scene ? sceneDataKey(scene) : "pending"), [scene]);
		const rootPlatformProps =
			Platform.OS === "web"
				? {
						dataSet: {
							diffView: "",
							lineWrap: String(scene?.layout.lineWrapEnabled ?? false),
							logicalRowCount: String(scene?.rows.length ?? 0),
							renderer: "legend-list",
							themeType: scene?.themeType ?? "dark",
						},
					}
				: {};
		const listPlatformProps =
			Platform.OS === "web"
				? ({
						"data-code": "",
						"data-testid": "diff-full-row-scroll",
						role: "code",
					} as Record<string, unknown>)
				: ({
						nestedScrollEnabled: true,
						onScrollEndDrag: handleVerticalDragEnd,
						testID: "diff-full-row-scroll",
					} as Record<string, unknown>);

		return (
			<View
				{...rootPlatformProps}
				className="min-h-0 flex-1 overflow-hidden bg-background"
				onLayout={handleLayout}
				testID="pierre-code-view"
			>
				{scene ? (
					<ScrollView
						contentContainerStyle={{ minWidth: "100%" }}
						horizontal
						onMomentumScrollEnd={handleHorizontalEnd}
						onScroll={handleHorizontalScroll}
						onScrollEndDrag={handleHorizontalEnd}
						ref={horizontalRef}
						scrollEventThrottle={32}
						showsHorizontalScrollIndicator
						style={{ flex: 1 }}
						testID="diff-horizontal-scroll"
					>
						<View
							style={{
								height: scene.viewport.height || undefined,
								minWidth: scene.contentSize.width,
								width: scene.viewport.width > 0 ? scene.contentSize.width : "100%",
							}}
						>
							<LegendList<DiffSceneRow>
								{...listPlatformProps}
								data={scene.rows}
								dataKey={dataKey}
								drawDistance={250}
								estimatedItemSize={scene.layout.lineHeight}
								getFixedItemSize={fixedRowSize}
								getItemType={rowType}
								key={dataKey}
								keyExtractor={rowKey}
								maintainVisibleContentPosition={false}
								onFirstVisibleItemChanged={handleFirstVisibleItemChanged}
								onMomentumScrollEnd={handleVerticalEnd}
								onLoad={handleLoad}
								onScroll={handleVerticalScroll}
								recycleItems
								ref={listRef}
								renderItem={renderItem}
								scrollEventThrottle={32}
								showsVerticalScrollIndicator
								style={{ flex: 1 }}
							/>
						</View>
					</ScrollView>
				) : null}
				<DiffSurfaceStatus session={session} />
			</View>
		);
	},
);
