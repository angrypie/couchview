import type { FileDiff } from "../../../shared/contracts.ts";
import type { ResolvedTheme } from "../../../shared/theme.ts";
import type { ViewerLineTarget } from "../../features/review/types.ts";

export type DiffDomCommand =
	| { revision: number; type: "top" }
	| { hunkIndex: number; revision: number; type: "hunk" }
	| { revision: number; target: ViewerLineTarget; type: "line" };

export type DiffDomCommandInput =
	| { type: "top" }
	| { hunkIndex: number; type: "hunk" }
	| { target: ViewerLineTarget; type: "line" };

export interface DiffDomProps {
	command: DiffDomCommand | null;
	diff: FileDiff;
	dom?: import("expo/dom").DOMProps;
	fontFamily: string;
	fontSize: number;
	interactive: boolean;
	lineHeightAdjustment: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	onIdentifierClick(identifier: string): Promise<void>;
	onVisibleLineChange(lineNumber: number, side: "old" | "new"): Promise<void>;
	themeType: ResolvedTheme;
	widthAdjustment: number;
}
