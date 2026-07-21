import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import type {
  CreateCommentRequest,
  ReviewComment,
  ReviewRecord,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";

interface StoredState {
  version: 1;
  reviews: ReviewRecord[];
  comments: ReviewComment[];
}

const EMPTY_STATE: StoredState = { version: 1, reviews: [], comments: [] };

function isStoredState(value: unknown): value is StoredState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredState>;
  return candidate.version === 1 && Array.isArray(candidate.reviews) && Array.isArray(candidate.comments);
}

export class ReviewStore {
  readonly directory: string;
  readonly filePath: string;
  readonly lockPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(gitDirectory: string) {
    this.directory = path.join(gitDirectory, "couch-review");
    this.filePath = path.join(this.directory, "state.json");
    this.lockPath = path.join(this.directory, "state.lock");
  }

  async snapshot(): Promise<StoredState> {
    await this.writeQueue;
    const state = await this.load();
    return structuredClone(state);
  }

  async setReview(record: ReviewRecord): Promise<ReviewRecord> {
    return this.mutate((state) => {
      const existing = state.reviews.findIndex((item) => item.fileId === record.fileId);
      if (existing >= 0) state.reviews[existing] = record;
      else state.reviews.push(record);
      return record;
    });
  }

  async createComment(
    input: CreateCommentRequest,
    pathName: string,
  ): Promise<ReviewComment> {
    const now = new Date().toISOString();
    const comment: ReviewComment = {
      id: randomUUID(),
      fileId: input.fileId,
      path: pathName,
      side: input.side,
      startLine: input.startLine,
      endLine: input.endLine,
      ...(input.oldStartLine === undefined ? {} : { oldStartLine: input.oldStartLine }),
      ...(input.oldEndLine === undefined ? {} : { oldEndLine: input.oldEndLine }),
      ...(input.newStartLine === undefined ? {} : { newStartLine: input.newStartLine }),
      ...(input.newEndLine === undefined ? {} : { newEndLine: input.newEndLine }),
      hunkHeader: input.hunkHeader,
      excerpt: input.excerpt,
      body: input.body,
      contentRevision: input.contentRevision,
      stale: false,
      createdAt: now,
      updatedAt: now,
    };
    return this.mutate((state) => {
      state.comments.push(comment);
      return comment;
    });
  }

  async updateComment(id: string, body: string): Promise<ReviewComment> {
    return this.mutate((state) => {
      const comment = state.comments.find((item) => item.id === id);
      if (!comment) throw new HttpError(404, "comment_not_found", "Comment not found");
      comment.body = body;
      comment.updatedAt = new Date().toISOString();
      return structuredClone(comment);
    });
  }

  async deleteComment(id: string): Promise<void> {
    await this.mutate((state) => {
      const index = state.comments.findIndex((item) => item.id === id);
      if (index < 0) throw new HttpError(404, "comment_not_found", "Comment not found");
      state.comments.splice(index, 1);
    });
  }

  private async load(): Promise<StoredState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isStoredState(parsed)) throw new Error("unsupported state shape");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Could not read Couch Review metadata: ${(error as Error).message}`);
      }
      return structuredClone(EMPTY_STATE);
    }
  }

  private async mutate<T>(mutation: (state: StoredState) => T): Promise<T> {
    let result!: T;
    const operation = this.writeQueue.then(async () => {
      const release = await this.acquireLock();
      try {
        const state = structuredClone(await this.load());
        result = mutation(state);
        await this.writeAtomically(state);
      } finally {
        await release();
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + 3_000;
    while (true) {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        await handle.writeFile(`${process.pid}\n`, "utf8");
        return async () => {
          await handle.close().catch(() => undefined);
          await unlink(this.lockPath).catch(() => undefined);
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const age = await stat(this.lockPath)
          .then((metadata) => Date.now() - metadata.mtimeMs)
          .catch(() => 0);
        if (age > 30_000) {
          await unlink(this.lockPath).catch(() => undefined);
          continue;
        }
        if (Date.now() >= deadline) {
          throw new HttpError(423, "state_locked", "Review state is busy; try again shortly");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  }

  private async writeAtomically(state: StoredState): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `state.${process.pid}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.filePath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}
