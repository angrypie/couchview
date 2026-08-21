import {
	benchTokenCacheKeySample,
	runDiffBenchScenarios,
} from "../src/client/components/diff/engine/benchScenarios.ts";

const engineMode = process.env.DIFF_BENCH_ENGINE === "js" ? "js" : "wasm";

console.log(`engine mode: ${engineMode}`);
await runDiffBenchScenarios((line) => console.log(line));
console.log(`tokenCacheKey sample: ${benchTokenCacheKeySample().slice(0, 40)}...`);
const mem = process.memoryUsage();
console.log(
	`rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
);
