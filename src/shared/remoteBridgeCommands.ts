function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function remoteBridgeZedUrl(
  sshAlias: string,
  repositoryRoot: string,
): string {
  const encodedPath = repositoryRoot
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `zed://ssh/${encodeURIComponent(sshAlias)}${encodedPath}`;
}

export function remoteBridgeZedCommand(
  sshAlias: string,
  repositoryRoot: string,
): string {
  const encodedPath = repositoryRoot
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `zed ${shellQuote(`ssh://${encodeURIComponent(sshAlias)}${encodedPath}`)}`;
}

export function remoteBridgeCodexCommand(
  sshAlias: string,
  repositoryRoot: string,
): string {
  return [
    "couchview bridge codex",
    `--profile ${sshAlias}`,
    `--repo ${shellQuote(repositoryRoot)}`,
  ].join(" ");
}
