const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;

for (const assetExtension of ["wasm", "woff2"]) {
	if (!config.resolver.assetExts.includes(assetExtension)) {
		config.resolver.assetExts.push(assetExtension);
	}
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
	const normalizedName =
		moduleName === "ghostty-web/ghostty-vt.wasm?url" ? "ghostty-web/ghostty-vt.wasm" : moduleName;
	if (defaultResolveRequest) return defaultResolveRequest(context, normalizedName, platform);
	return context.resolveRequest(context, normalizedName, platform);
};

const universalConfig = withUniwindConfig(config, {
	cssEntryFile: "./native.css",
	dtsFile: "./.uniwind-types.generated.d.ts",
});

const defaultSerializer = universalConfig.serializer.customSerializer;

if (defaultSerializer) {
	// Each Expo DOM island is an independent HTML document, so its dependency graph must be
	// self-contained. Shared split chunks can otherwise point outside the island's asset set.
	const standaloneDomSerializer = (entryPoint, preModules, graph, options) => {
		const isDomBundle = Boolean(graph.transformOptions?.customTransformOptions?.dom);
		if (!isDomBundle) return defaultSerializer(entryPoint, preModules, graph, options);
		return defaultSerializer(entryPoint, preModules, graph, {
			...options,
			serializerOptions: {
				...options.serializerOptions,
				splitChunks: false,
			},
		});
	};
	Object.assign(standaloneDomSerializer, defaultSerializer);
	universalConfig.serializer.customSerializer = standaloneDomSerializer;
}

module.exports = universalConfig;
