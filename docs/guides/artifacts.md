# Repository artifacts

**Audience:** People defining, building, and downloading ephemeral repository artifacts.

## Ephemeral repository artifacts

Open **Artifacts** for a repository to type one familiar build command, a repository-relative
working directory, and one exact file or directory output. Couchview parses quotes and escapes
into exact argv, rejects shell operators and expansion, and invokes the result without a shell.
It snapshots the output only after a zero exit code and retains the latest two successful
snapshots. A directory is downloaded as a `.tar.gz`; installation, signing, and moving the
downloaded result remain the user's responsibility. Normal attachment links stream directly to
desktop and mobile browsers, including Safari on iPhone and iPad.

**Suggest with Codex** optionally accepts a short intent such as “static build” or “compile with
Bun”; leaving it empty asks for the project's most useful configured build. Couchview supplies
only recognized, shallow build configuration files under strict count and byte limits. Codex
cannot inspect source or the repository and returns one editable form draft—it never saves or
builds the suggestion automatically. The **Codex generation** settings select the model and
reasoning effort shared with commit-message generation.

The same catalog is available from a terminal. Local commands require an already-running
Couchview server and never start one implicitly:

```sh
couchview artifacts list --repo /absolute/path/to/project
couchview artifacts build couchview-cli --repo /absolute/path/to/project
couchview artifacts download couchview-cli --repo /absolute/path/to/project
couchview artifacts pull couchview-cli --repo /absolute/path/to/project
```

`pull` starts a build, streams its logs, and downloads that exact successful snapshot.
`download` selects the latest success by default; `--build <id>` selects the older retained
snapshot. Downloads use the artifact basename in the current directory, verify size and
SHA-256, and refuse to overwrite unless `--force` is supplied. Use `--output <file>` for a
different destination and `--json` for machine-readable stdout.

After pairing a client, the Artifacts page can copy an unambiguous host-wide command with
the managed SSH alias and stable server repository ID:

```sh
couchview artifacts pull couchview-cli \
  --profile couchview-project-name-12345678 \
  --repository 8f14e45fceea167a5a36dedd
```

Without an explicit repository, paired clients match credential-free hashes of normalized
Git remote host/path identities and require `--repository` if the result is not unique.
Paired clients can list, build, and download artifacts in any registered repository, but
only the browser can create, edit, or delete definitions.


## Security boundary

Artifact commands execute with the Couchview host user's permissions. Read the
[artifact security details](../security.md#artifact-execution) before exposing artifact actions to
another device.
