import { useMemo, type ReactNode } from "react";
import {
  WorkerPoolContextProvider,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions,
} from "@pierre/diffs/react";
import PierreWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url";

const highlighterOptions: WorkerInitializationRenderOptions = {
  theme: "pierre-dark",
  lineDiffType: "word-alt",
  useTokenTransformer: true,
  tokenizeMaxLineLength: 2_000,
};

export function PierreWorkerProvider({ children }: { children: ReactNode }) {
  const poolOptions = useMemo<WorkerPoolOptions>(
    () => ({
      poolSize: 2,
      totalASTLRUCacheSize: 16,
      workerFactory: () => new Worker(PierreWorkerUrl, { type: "module" }),
    }),
    [],
  );

  return (
    <WorkerPoolContextProvider
      highlighterOptions={highlighterOptions}
      poolOptions={poolOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
