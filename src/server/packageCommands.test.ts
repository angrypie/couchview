import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { PackageRunSummary } from "../shared/contracts.ts";
import { PackageCommandService } from "./packageCommands.ts";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((fixture) =>
      rm(fixture, { recursive: true, force: true })
    ),
  );
});

async function repositoryFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "couch-review-packages-"));
  fixtures.push(root);
  expect(Bun.spawnSync(["git", "init", "-q", root]).exitCode).toBe(0);
  return root;
}

async function put(
  root: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

function git(root: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stderr: "pipe",
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
}

async function terminalRun(
  service: PackageCommandService,
  repositoryId: string,
  runId: string,
): Promise<PackageRunSummary> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const run = service.runs(repositoryId).find((item) => item.id === runId);
    if (run && !["running", "stopping"].includes(run.status)) return run;
    await Bun.sleep(20);
  }
  throw new Error("Package run did not finish");
}

describe("PackageCommandService", () => {
  test("discovers root and nested packages while excluding ignored and node_modules manifests", async () => {
    const root = await repositoryFixture();
    await put(
      root,
      "package.json",
      JSON.stringify({
        name: "root-package",
        packageManager: "pnpm@10.0.0",
        scripts: { test: "echo root" },
      }),
    );
    await put(
      root,
      "apps/web/package.json",
      JSON.stringify({
        name: "web-package",
        packageManager: "yarn@4.0.0",
        scripts: { dev: "vite", invalid: 42 },
      }),
    );
    await put(root, "broken/package.json", "{");
    await put(
      root,
      "node_modules/tracked/package.json",
      JSON.stringify({ scripts: { hidden: "echo hidden" } }),
    );
    await put(root, ".gitignore", "ignored/\n");
    await put(
      root,
      "ignored/package.json",
      JSON.stringify({ scripts: { hidden: "echo ignored" } }),
    );
    await mkdir(path.join(root, "linked"), { recursive: true });
    await symlink("../package.json", path.join(root, "linked/package.json"));
    git(
      root,
      "add",
      "package.json",
      "apps/web/package.json",
      "broken/package.json",
      ".gitignore",
    );
    git(root, "add", "-f", "node_modules/tracked/package.json");

    const service = new PackageCommandService();
    const result = await service.discover(root);

    expect(result.packages.map((item) => item.packagePath)).toEqual([
      "package.json",
      "apps/web/package.json",
    ]);
    expect(result.packages[0]).toMatchObject({
      name: "root-package",
      directory: ".",
      runner: "pnpm",
      scripts: [{ name: "test", command: "echo root" }],
    });
    expect(result.packages[1]).toMatchObject({
      name: "web-package",
      directory: "apps/web",
      runner: "yarn",
      scripts: [{ name: "dev", command: "vite" }],
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packagePath: "broken/package.json",
          message: "Manifest is not valid JSON",
        }),
        expect.objectContaining({
          packagePath: "apps/web/package.json",
          message: expect.stringContaining("invalid"),
        }),
        expect.objectContaining({
          packagePath: "linked/package.json",
          message: "Symbolic-link manifests are ignored",
        }),
      ]),
    );
  });

  test("uses the nearest lockfile and falls back to Bun", async () => {
    const root = await repositoryFixture();
    await put(
      root,
      "package.json",
      JSON.stringify({ scripts: { root: "echo root" } }),
    );
    await put(
      root,
      "apps/api/package.json",
      JSON.stringify({ scripts: { api: "echo api" } }),
    );
    await put(root, "apps/api/package-lock.json", "{}");
    git(root, "add", ".");

    const service = new PackageCommandService();
    const result = await service.discover(root);

    expect(result.packages.find((item) => item.directory === ".")?.runner).toBe(
      "bun",
    );
    expect(
      result.packages.find((item) => item.directory === "apps/api")?.runner,
    ).toBe("npm");
  });

  test("runs exact scripts, streams output, records failure, and rejects stale revisions", async () => {
    const root = await repositoryFixture();
    await put(
      root,
      "package.json",
      JSON.stringify({
        scripts: {
          ok: "printf 'hello'; printf 'problem' >&2",
          fail: "printf 'failed' >&2; exit 7",
        },
      }),
    );
    git(root, "add", "package.json");
    const service = new PackageCommandService({
      resolveExecutable: () => process.execPath,
    });
    const discovery = await service.discover(root);
    const packageEntry = discovery.packages[0]!;

    const started = await service.start("repository", root, {
      packagePath: packageEntry.packagePath,
      scriptName: "ok",
      manifestRevision: packageEntry.manifestRevision,
    });
    const events: string[] = [];
    const subscription = service.subscribe(
      "repository",
      started.id,
      (event) => {
        if (event.type === "output") events.push(event.chunk.text);
      },
    );
    const completed = await terminalRun(service, "repository", started.id);
    subscription.unsubscribe();

    expect(completed).toMatchObject({ status: "succeeded", exitCode: 0 });
    const snapshotText = service.subscribe(
      "repository",
      started.id,
      () => undefined,
    ).snapshot.output.map((chunk) => chunk.text).join("");
    expect(`${events.join("")}${snapshotText}`).toContain("hello");
    expect(snapshotText).toContain("problem");

    const failed = await service.start("repository", root, {
      packagePath: packageEntry.packagePath,
      scriptName: "fail",
      manifestRevision: packageEntry.manifestRevision,
    });
    expect(
      await terminalRun(service, "repository", failed.id),
    ).toMatchObject({ status: "failed", exitCode: 7 });

    await put(
      root,
      "package.json",
      JSON.stringify({ scripts: { ok: "echo changed" } }),
    );
    const error = await service.start("repository", root, {
      packagePath: packageEntry.packagePath,
      scriptName: "ok",
      manifestRevision: packageEntry.manifestRevision,
    }).catch((caught) => caught);
    expect(error).toMatchObject({
      status: 409,
      code: "package_scripts_changed",
    });
    service.close();
  });

  test("rejects duplicate active scripts and stops long-running processes", async () => {
    const root = await repositoryFixture();
    await put(
      root,
      "package.json",
      JSON.stringify({ scripts: { dev: "sleep 30" } }),
    );
    git(root, "add", "package.json");
    const service = new PackageCommandService({
      resolveExecutable: () => process.execPath,
    });
    const packageEntry = (await service.discover(root)).packages[0]!;
    const input = {
      packagePath: packageEntry.packagePath,
      scriptName: "dev",
      manifestRevision: packageEntry.manifestRevision,
    };
    const run = await service.start("repository", root, input);

    expect(
      await service.start("repository", root, input).catch((caught) => caught),
    ).toMatchObject({ status: 409, code: "package_script_running" });
    expect(service.stop("repository", run.id).status).toBe("stopping");
    expect(
      await terminalRun(service, "repository", run.id),
    ).toMatchObject({ status: "stopped" });
    expect(service.stop("repository", run.id).status).toBe("stopped");
    service.close();
  });

  test("caps concurrency and retained output and records unavailable runners", async () => {
    const root = await repositoryFixture();
    await put(
      root,
      "package.json",
      JSON.stringify({
        scripts: {
          first: "sleep 30",
          second: "sleep 30",
          loud: "printf '%0256d' 0",
        },
      }),
    );
    git(root, "add", "package.json");
    const service = new PackageCommandService({
      maxConcurrentRuns: 1,
      maxOutputBytes: 64,
      resolveExecutable: () => process.execPath,
    });
    const packageEntry = (await service.discover(root)).packages[0]!;
    const inputFor = (scriptName: string) => ({
      packagePath: packageEntry.packagePath,
      scriptName,
      manifestRevision: packageEntry.manifestRevision,
    });
    const first = await service.start(
      "repository",
      root,
      inputFor("first"),
    );
    expect(
      await service.start("repository", root, inputFor("second")).catch(
        (caught) => caught,
      ),
    ).toMatchObject({ status: 429, code: "package_run_limit" });
    service.stop("repository", first.id);
    await terminalRun(service, "repository", first.id);

    const loud = await service.start("repository", root, inputFor("loud"));
    const loudResult = await terminalRun(service, "repository", loud.id);
    const loudSnapshot = service.subscribe(
      "repository",
      loud.id,
      () => undefined,
    ).snapshot;
    expect(loudResult.outputTruncated).toBe(true);
    expect(
      Buffer.byteLength(
        loudSnapshot.output.map((chunk) => chunk.text).join(""),
      ),
    ).toBeLessThanOrEqual(64);
    service.close();

    await put(
      root,
      "package.json",
      JSON.stringify({
        packageManager: "pnpm@10.0.0",
        scripts: { test: "echo unavailable" },
      }),
    );
    const unavailable = new PackageCommandService({
      resolveExecutable: () => null,
    });
    const unavailablePackage = (await unavailable.discover(root)).packages[0]!;
    const failed = await unavailable.start("repository", root, {
      packagePath: unavailablePackage.packagePath,
      scriptName: "test",
      manifestRevision: unavailablePackage.manifestRevision,
    });
    expect(failed).toMatchObject({ runner: "pnpm", status: "failed" });
    expect(
      unavailable
        .subscribe("repository", failed.id, () => undefined)
        .snapshot.output.map((chunk) => chunk.text)
        .join(""),
    ).toContain("Could not find pnpm");
    unavailable.close();
  });
});
