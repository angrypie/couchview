export function waitForDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new DOMException("The request was aborted.", "AbortError"));
			return;
		}
		const onAbort = () => {
			clearTimeout(timeout);
			reject(new DOMException("The request was aborted.", "AbortError"));
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, milliseconds);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
