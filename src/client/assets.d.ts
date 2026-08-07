declare module "*.css";

declare module "*.wasm" {
	const asset: string;
	export default asset;
}

declare module "*?url" {
	const url: string;
	export default url;
}
