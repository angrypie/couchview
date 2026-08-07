import { useWindowDimensions } from "react-native";

const TABLET_SPLIT_WIDTH = 900;
const COMPACT_LANDSCAPE_HEIGHT = 600;

export interface WorkspaceLayout {
	compactLandscape: boolean;
	splitView: boolean;
}

export function workspaceLayout(width: number, height: number): WorkspaceLayout {
	const landscape = width > height;
	const splitView = width >= TABLET_SPLIT_WIDTH && (landscape || width >= 1180);
	return {
		compactLandscape: landscape && height < COMPACT_LANDSCAPE_HEIGHT && !splitView,
		splitView,
	};
}

export function useWorkspaceLayout(): WorkspaceLayout {
	const { height, width } = useWindowDimensions();
	return workspaceLayout(width, height);
}
