export async function confirmAction(message: string, _title = "Couchview"): Promise<boolean> {
	return typeof globalThis.confirm === "function" ? globalThis.confirm(message) : false;
}
