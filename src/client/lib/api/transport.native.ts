import { fetch as expoFetch } from "expo/fetch";
import type { FetchLike } from "./fetchTypes.ts";

export const platformFetch: FetchLike = (input, init) => expoFetch(input, init);
