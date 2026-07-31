import { describe, expect, test } from "bun:test";

import {
  remoteBridgeCodexCommand,
  remoteBridgeZedCommand,
  remoteBridgeZedUrl,
} from "./remoteBridgeCommands.ts";

describe("remote bridge launch commands", () => {
  test("builds Zed deep links and CLI commands for an absolute remote path", () => {
    expect(remoteBridgeZedUrl(
      "couchview-project-one-11111111",
      "/Users/mini/Code/Project One",
    )).toBe(
      "zed://ssh/couchview-project-one-11111111/Users/mini/Code/Project%20One",
    );
    expect(remoteBridgeZedCommand(
      "couchview-project-one-11111111",
      "/Users/mini/Code/Project One",
    )).toBe(
      "zed 'ssh://couchview-project-one-11111111/Users/mini/Code/Project%20One'",
    );
  });

  test("quotes the selected repository for the Couchview Codex launcher", () => {
    expect(remoteBridgeCodexCommand(
      "couchview-project-one-11111111",
      "/Users/mini/Code/Project One",
    )).toBe(
      "couchview bridge codex --profile couchview-project-one-11111111 --repo '/Users/mini/Code/Project One'",
    );
  });
});
