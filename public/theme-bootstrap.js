(() => {
	const storageKey = "couchview:theme-preference:v1";
	const preferenceAttribute = "data-theme-preference";
	const root = document.documentElement;
	let preference = "system";
	try {
		const stored = window.localStorage.getItem(storageKey);
		if (stored === "light" || stored === "dark") preference = stored;
	} catch {
		// System appearance remains available when storage access is blocked.
	}
	const resolved =
		preference === "system"
			? window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light"
			: preference;
	root.classList.remove("light", "dark");
	root.classList.add(resolved);
	root.setAttribute(preferenceAttribute, preference);
	root.style.colorScheme = resolved;
	const themeColor = document.querySelector('meta[name="theme-color"]');
	if (themeColor) themeColor.setAttribute("content", resolved === "dark" ? "#101317" : "#f6f8fb");
})();
