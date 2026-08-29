export type QuickPickMode = "projects" | "files";

export const QUICK_PICKER_SEARCH_INPUT_ID = "quick-picker-search-input";

export interface QuickPickItem {
	id: string;
	kind: QuickPickMode;
	searchText: string;
	subtitle: string;
	title: string;
}

export interface QuickPickerKeyboardOptions {
	mode: QuickPickMode | null;
	onClose: () => void;
	onMove: (direction: -1 | 1) => void;
	onSelect: () => void;
}
