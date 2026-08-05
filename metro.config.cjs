const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;

if (!config.resolver.assetExts.includes("wasm")) {
	config.resolver.assetExts.push("wasm");
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
	const normalizedName =
		moduleName === "ghostty-web/ghostty-vt.wasm?url" ? "ghostty-web/ghostty-vt.wasm" : moduleName;
	if (defaultResolveRequest) return defaultResolveRequest(context, normalizedName, platform);
	return context.resolveRequest(context, normalizedName, platform);
};

module.exports = config;
