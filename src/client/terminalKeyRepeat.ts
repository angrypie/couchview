function printableKey(event: KeyboardEvent): boolean {
	return (
		!event.isComposing &&
		event.key !== "Dead" &&
		event.key.length === 1 &&
		!event.ctrlKey &&
		!event.altKey &&
		!event.metaKey
	);
}

function keyIdentity(event: KeyboardEvent): string {
	return event.code || event.key;
}

export function installTerminalKeyRepeat(container: HTMLElement): () => void {
	const ownerWindow = container.ownerDocument.defaultView;
	if (!ownerWindow) return () => undefined;

	const originalContentEditable = container.getAttribute("contenteditable");
	const heldPrintableKeys = new Set<string>();

	const restoreEditableInput = () => {
		heldPrintableKeys.clear();
		if (originalContentEditable === null) container.removeAttribute("contenteditable");
		else container.setAttribute("contenteditable", originalContentEditable);
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (!printableKey(event)) return;
		heldPrintableKeys.add(keyIdentity(event));

		// macOS treats a focused editable element as text entry and replaces key
		// repeat with its accent chooser. Ghostty consumes keydown itself, so the
		// host can be non-editable until keyup while native repeat events continue.
		container.setAttribute("contenteditable", "false");
	};

	const onKeyUp = (event: KeyboardEvent) => {
		heldPrintableKeys.delete(keyIdentity(event));
		if (heldPrintableKeys.size === 0) restoreEditableInput();
	};

	container.addEventListener("keydown", onKeyDown, true);
	ownerWindow.addEventListener("keyup", onKeyUp, true);
	ownerWindow.addEventListener("blur", restoreEditableInput);

	return () => {
		container.removeEventListener("keydown", onKeyDown, true);
		ownerWindow.removeEventListener("keyup", onKeyUp, true);
		ownerWindow.removeEventListener("blur", restoreEditableInput);
		restoreEditableInput();
	};
}
