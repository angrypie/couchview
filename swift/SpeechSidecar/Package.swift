// swift-tools-version: 6.0

import PackageDescription

let package = Package(
	name: "CouchviewSpeechSidecar",
	platforms: [.macOS(.v14)],
	products: [
		.executable(name: "couchview-speech-sidecar", targets: ["CouchviewSpeechSidecar"]),
	],
	dependencies: [
		.package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.15.5"),
	],
	targets: [
		.executableTarget(
			name: "CouchviewSpeechSidecar",
			dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]
		),
	]
)
