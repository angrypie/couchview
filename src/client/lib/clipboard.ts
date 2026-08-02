export async function copyToClipboard(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {
			// Local HTTP and older browsers may reject Clipboard API access.
		}
	}

	const field = document.createElement("textarea");
	field.value = text;
	field.setAttribute("readonly", "");
	field.style.position = "fixed";
	field.style.opacity = "0";
	document.body.append(field);
	field.select();
	const copied = document.execCommand("copy");
	field.remove();
	if (!copied) throw new Error("Copy was blocked. Select and copy the text manually.");
}
