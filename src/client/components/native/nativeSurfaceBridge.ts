import {
	normalizeThemePreference,
	THEME_PREFERENCE_ATTRIBUTE,
	type ThemePreference,
} from "../../../shared/theme.ts";

export function createNativeSurfaceScript(themePreference: ThemePreference): string {
	const attribute = JSON.stringify(THEME_PREFERENCE_ATTRIBUTE);
	const preference = JSON.stringify(normalizeThemePreference(themePreference));
	return `
(function () {
	function invoke(actionId, args) {
		window.ReactNativeWebView?.postMessage(JSON.stringify({
			type: "$$native_action",
			data: { uid: Math.random().toString(36).slice(2), actionId: actionId, args: args || [] }
		}));
	}
	function isThemePreference(value) {
		return value === "system" || value === "light" || value === "dark";
	}
	var attribute = ${attribute};
	var nativePreference = ${preference};
	var root = document.documentElement;
	var currentPreference = root.getAttribute(attribute);
	var lastPreference;
	if (isThemePreference(currentPreference)) {
		lastPreference = currentPreference;
		if (currentPreference !== nativePreference) {
			invoke("onThemePreferenceChange", [currentPreference]);
		}
	} else {
		lastPreference = nativePreference;
		root.setAttribute(attribute, nativePreference);
	}
	if (typeof MutationObserver === "function") {
		var observer = new MutationObserver(function () {
			var nextPreference = root.getAttribute(attribute);
			if (!isThemePreference(nextPreference) || nextPreference === lastPreference) return;
			lastPreference = nextPreference;
			invoke("onThemePreferenceChange", [nextPreference]);
		});
		observer.observe(root, { attributes: true, attributeFilter: [attribute] });
	}
	function ready() { invoke("onSurfaceReady"); }
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", ready, { once: true });
	} else {
		ready();
	}
	document.addEventListener("click", function (event) {
		var target = event.target;
		var anchor = target && target.closest ? target.closest("a") : null;
		if (!anchor || anchor.getAttribute("href") !== "couchview://servers") return;
		event.preventDefault();
		invoke("onManageServers");
	}, true);
})();
true;
`;
}
