import type { FetchLike } from "./fetchTypes.ts";

export const platformFetch: FetchLike = (input, init) => globalThis.fetch(input, init);
