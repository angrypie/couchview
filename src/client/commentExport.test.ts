import { describe, expect, test } from "bun:test";
import type { ReviewComment } from "../shared/contracts.ts";
import { exportCommentsForCodex, formatCommentReference } from "./commentExport.ts";

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "comment-1",
    fileId: "file-1",
    path: "src/example.ts",
    side: "new",
    startLine: 12,
    endLine: 14,
    hunkHeader: "@@ -10,3 +10,6 @@",
    excerpt: ["const answer = 42;"],
    body: "Please extract this value.",
    contentRevision: "revision-1",
    stale: false,
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

describe("Codex comment export", () => {
  test("formats new and old-side line references", () => {
    expect(formatCommentReference(comment())).toBe("src/example.ts:L12-L14");
    expect(
      formatCommentReference(
        comment({ path: "old.ts", side: "old", startLine: 8, endLine: 8 }),
      ),
    ).toBe("old.ts:L8 (old)");
    expect(
      formatCommentReference(
        comment({
          side: "mixed",
          startLine: 20,
          endLine: 22,
          oldStartLine: 10,
          oldEndLine: 11,
          newStartLine: 20,
          newEndLine: 22,
        }),
      ),
    ).toBe("src/example.ts:old L10-L11 / new L20-L22");
  });

  test("sorts current comments, omits stale anchors, and preserves excerpts", () => {
    const output = exportCommentsForCodex([
      comment({ path: "z.ts", startLine: 20, endLine: 20 }),
      comment({
        id: "comment-2",
        path: "a.ts",
        startLine: 2,
        endLine: 2,
        stale: true,
        body: "Handle the empty case.",
      }),
    ]);

    expect(output).not.toContain("a.ts:L2");
    expect(output).toContain("z.ts:L20");
    expect(output).toContain('Comment (JSON): "Please extract this value."');
    expect(output).toContain("       const answer = 42;");
    expect(output).not.toContain("Handle the empty case.");
  });

  test("tells Codex to answer informational questions without editing", () => {
    const output = exportCommentsForCodex([
      comment({ body: "What does this message do?" }),
    ]);

    expect(output).toContain("Informational questions");
    expect(output).toContain("Intent: informational question — answer only; do not edit files.");
    expect(output).toContain("leave the workspace unchanged");
  });

  test("quotes unusual paths and keeps multiline Markdown inside JSON", () => {
    const output = exportCommentsForCodex([
      comment({
        path: "src/weird\n`name`.ts",
        body: "First line\n# injected heading",
      }),
    ]);

    expect(output).toContain('"src/weird\\n`name`.ts":L12-L14');
    expect(output).toContain('Comment (JSON): "First line\\n# injected heading"');
    expect(output).not.toContain("\n# injected heading");
  });
});
