import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import packageJson from "../../package.json" with { type: "json" };

export const CLI_VERSION = packageJson.version;

export type CliCommandName = "serve" | "restart" | "completion";
export type CompletionShell = "zsh" | "bash" | "fish";

type CliOptionType = "boolean" | "string";

interface CliOptionDefinition {
  name: string;
  short?: string;
  type: CliOptionType;
  valueName?: string;
  description: string;
  commands: readonly CliCommandName[];
  completion?: "directory";
}

const commandNames = ["serve", "restart", "completion", "help"] as const;
const completionShells: readonly CompletionShell[] = ["zsh", "bash", "fish"];

const optionDefinitions: readonly CliOptionDefinition[] = [
  {
    name: "help",
    short: "h",
    type: "boolean",
    description: "Show command help and exit.",
    commands: ["serve", "restart", "completion"],
  },
  {
    name: "version",
    short: "V",
    type: "boolean",
    description: "Show the Couchview version and exit.",
    commands: ["serve", "restart", "completion"],
  },
  {
    name: "install",
    type: "boolean",
    description: "Install Fish completion in the standard per-user directory.",
    commands: ["completion"],
  },
  {
    name: "repo",
    short: "r",
    type: "string",
    valueName: "path",
    description: "Repository to review (default: current directory).",
    commands: ["serve"],
    completion: "directory",
  },
  {
    name: "host",
    short: "H",
    type: "string",
    valueName: "address",
    description: "Bind address (default: 127.0.0.1).",
    commands: ["serve", "restart"],
  },
  {
    name: "port",
    short: "p",
    type: "string",
    valueName: "number",
    description: "HTTP port from 1 to 65535 (default: 4173).",
    commands: ["serve", "restart"],
  },
  {
    name: "interactive",
    short: "i",
    type: "boolean",
    description: "Prompt for omitted startup settings before serving.",
    commands: ["serve"],
  },
  {
    name: "enable-terminal",
    type: "boolean",
    description: "Enable browser terminal access, including beyond loopback.",
    commands: ["serve"],
  },
  {
    name: "disable-terminal",
    type: "boolean",
    description: "Disable browser terminal access.",
    commands: ["serve"],
  },
  {
    name: "enable-terminal-p2p",
    type: "boolean",
    description: "Opt into direct terminal P2P transport and IP disclosure.",
    commands: ["serve"],
  },
  {
    name: "disable-terminal-p2p",
    type: "boolean",
    description: "Force terminal traffic to use the protected WebSocket.",
    commands: ["serve"],
  },
] as const;

export interface ParsedServeArguments {
  repo: string | undefined;
  host: string | undefined;
  port: string | undefined;
  interactive: boolean;
  help: boolean;
  version: boolean;
  terminalMode: "enabled" | "disabled" | undefined;
  terminalP2pMode: "enabled" | "disabled" | undefined;
  explicit: {
    repo: boolean;
    host: boolean;
    port: boolean;
    terminal: boolean;
  };
}

export interface ParsedRestartArguments {
  host: string | undefined;
  port: string | undefined;
  help: boolean;
  version: boolean;
}

export type CliInvocation =
  | {
      kind: "serve";
      argv: string[];
      parsed: ParsedServeArguments;
    }
  | {
      kind: "restart";
      argv: string[];
      parsed: ParsedRestartArguments;
    }
  | {
      kind: "completion";
      shell: CompletionShell;
      install: boolean;
    }
  | {
      kind: "help";
      command: CliCommandName | null;
    }
  | {
      kind: "version";
    };

export class CliUsageError extends Error {
  constructor(
    message: string,
    readonly helpCommand: CliCommandName | null = null,
  ) {
    super(message);
    this.name = "CliUsageError";
  }
}

export class CliPromptInterrupted extends Error {
  constructor() {
    super("Interactive setup was cancelled.");
    this.name = "CliPromptInterrupted";
  }
}

function optionsFor(command: CliCommandName): CliOptionDefinition[] {
  return optionDefinitions.filter((option) => option.commands.includes(command));
}

function normalizeSingleDashValues(command: CliCommandName, args: string[]): string[] {
  const stringOptions = new Map<string, CliOptionDefinition>();
  for (const option of optionsFor(command)) {
    if (option.type !== "string") continue;
    stringOptions.set(`--${option.name}`, option);
    if (option.short) stringOptions.set(`-${option.short}`, option);
  }
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      normalized.push(...args.slice(index));
      break;
    }
    const option = argument ? stringOptions.get(argument) : undefined;
    const value = args[index + 1];
    if (option && value?.startsWith("-") && !value.startsWith("--")) {
      normalized.push(`--${option.name}=${value}`);
      index += 1;
    } else if (argument !== undefined) {
      normalized.push(argument);
    }
  }
  return normalized;
}

function parseOptions(command: CliCommandName, args: string[]) {
  const options: Record<string, { type: CliOptionType; short?: string }> = {};
  for (const definition of optionsFor(command)) {
    options[definition.name] = {
      type: definition.type,
      ...(definition.short ? { short: definition.short } : {}),
    };
  }
  try {
    return parseArgs({
      args: normalizeSingleDashValues(command, args),
      options,
      strict: true,
      allowPositionals: true,
      tokens: true,
    });
  } catch (error) {
    const message = (error as Error).message.replace(/^TypeError:\s*/i, "");
    const unknown = /Unknown option ['\"]?([^'\"\s]+)['\"]?/i.exec(message)?.[1];
    const suggestion = unknown
      ? nearestValue(
          unknown,
          optionsFor(command).flatMap((option) => [
            `--${option.name}`,
            ...(option.short ? [`-${option.short}`] : []),
          ]),
        )
      : null;
    const missingValue = [
      ["repo", "Repository path is required"],
      ["host", "Host is required"],
      ["port", "Port must be between 1 and 65535"],
    ].find(([name]) =>
      message.includes(`--${name}`) &&
      (/argument missing/i.test(message) || /argument is ambiguous/i.test(message))
    )?.[1];
    const conciseMessage = missingValue ?? (unknown ? `Unknown option: ${unknown}.` : message);
    throw new CliUsageError(
      `${conciseMessage}${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
      command,
    );
  }
}

function booleanValue(values: Record<string, unknown>, name: string): boolean {
  return values[name] === true;
}

function stringValue(values: Record<string, unknown>, name: string): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

function optionCount(
  tokens: ReturnType<typeof parseOptions>["tokens"],
  name: string,
): number {
  return tokens.filter((token) => token.kind === "option" && token.name === name).length;
}

function rejectDuplicateOptions(
  command: CliCommandName,
  tokens: ReturnType<typeof parseOptions>["tokens"],
): void {
  for (const definition of optionsFor(command)) {
    if (optionCount(tokens, definition.name) > 1) {
      throw new CliUsageError(
        `Option '--${definition.name}' may only be provided once.`,
        command,
      );
    }
  }
}

export function parseServeArguments(
  args: string[],
  allowPositionalRepo = false,
): ParsedServeArguments {
  const parsed = parseOptions("serve", args);
  rejectDuplicateOptions("serve", parsed.tokens);
  const positionalRepo = parsed.positionals[0];
  const optionRepo = stringValue(parsed.values, "repo");
  if (optionRepo !== undefined && positionalRepo !== undefined) {
    throw new CliUsageError("Repository path may only be provided once.", "serve");
  }
  if (positionalRepo !== undefined && !allowPositionalRepo) {
    throw new CliUsageError(
      "Repository paths must follow the 'serve' command or '--repo'.",
      "serve",
    );
  }
  if (parsed.positionals.length > 1) {
    throw new CliUsageError("Repository path may only be provided once.", "serve");
  }
  const terminalEnabled = booleanValue(parsed.values, "enable-terminal");
  const terminalDisabled = booleanValue(parsed.values, "disable-terminal");
  if (terminalEnabled && terminalDisabled) {
    throw new CliUsageError(
      "--enable-terminal and --disable-terminal cannot be used together.",
      "serve",
    );
  }
  const terminalP2pEnabled = booleanValue(parsed.values, "enable-terminal-p2p");
  const terminalP2pDisabled = booleanValue(parsed.values, "disable-terminal-p2p");
  if (terminalP2pEnabled && terminalP2pDisabled) {
    throw new CliUsageError(
      "--enable-terminal-p2p and --disable-terminal-p2p cannot be used together.",
      "serve",
    );
  }
  return {
    repo: optionRepo ?? positionalRepo,
    host: stringValue(parsed.values, "host"),
    port: stringValue(parsed.values, "port"),
    interactive: booleanValue(parsed.values, "interactive"),
    help: booleanValue(parsed.values, "help"),
    version: booleanValue(parsed.values, "version"),
    terminalMode: terminalEnabled ? "enabled" : terminalDisabled ? "disabled" : undefined,
    terminalP2pMode: terminalP2pEnabled
      ? "enabled"
      : terminalP2pDisabled
        ? "disabled"
        : undefined,
    explicit: {
      repo: optionRepo !== undefined || positionalRepo !== undefined,
      host: optionCount(parsed.tokens, "host") === 1,
      port: optionCount(parsed.tokens, "port") === 1,
      terminal:
        terminalEnabled || terminalDisabled || terminalP2pEnabled || terminalP2pDisabled,
    },
  };
}

export function parseRestartArguments(args: string[]): ParsedRestartArguments {
  const parsed = parseOptions("restart", args);
  rejectDuplicateOptions("restart", parsed.tokens);
  if (parsed.positionals.length > 0) {
    throw new CliUsageError("The restart command does not accept a repository path.", "restart");
  }
  return {
    host: stringValue(parsed.values, "host"),
    port: stringValue(parsed.values, "port"),
    help: booleanValue(parsed.values, "help"),
    version: booleanValue(parsed.values, "version"),
  };
}

function parseCompletionArguments(args: string[]): {
  shell: CompletionShell | undefined;
  help: boolean;
  version: boolean;
  install: boolean;
} {
  const parsed = parseOptions("completion", args);
  rejectDuplicateOptions("completion", parsed.tokens);
  if (parsed.positionals.length > 1) {
    throw new CliUsageError("The completion command accepts exactly one shell.", "completion");
  }
  const rawShell = parsed.positionals[0];
  if (rawShell !== undefined && !completionShells.includes(rawShell as CompletionShell)) {
    const suggestion = nearestValue(rawShell, completionShells);
    throw new CliUsageError(
      `Unsupported shell '${rawShell}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
      "completion",
    );
  }
  const install = booleanValue(parsed.values, "install");
  if (install && rawShell !== "fish") {
    throw new CliUsageError(
      "Automatic completion installation currently supports Fish only.",
      "completion",
    );
  }
  return {
    shell: rawShell as CompletionShell | undefined,
    help: booleanValue(parsed.values, "help"),
    version: booleanValue(parsed.values, "version"),
    install,
  };
}

function canonicalServeArguments(parsed: ParsedServeArguments): string[] {
  const argv: string[] = [];
  if (parsed.explicit.repo && parsed.repo !== undefined) argv.push(`--repo=${parsed.repo}`);
  if (parsed.explicit.host && parsed.host !== undefined) argv.push("--host", parsed.host);
  if (parsed.explicit.port && parsed.port !== undefined) argv.push("--port", parsed.port);
  if (parsed.interactive) argv.push("--interactive");
  if (parsed.terminalMode === "enabled") argv.push("--enable-terminal");
  if (parsed.terminalMode === "disabled") argv.push("--disable-terminal");
  if (parsed.terminalP2pMode === "enabled") argv.push("--enable-terminal-p2p");
  if (parsed.terminalP2pMode === "disabled") argv.push("--disable-terminal-p2p");
  return argv;
}

export function parseCliInvocation(argv: string[]): CliInvocation {
  const first = argv[0];
  if (first === "help") {
    if (argv.length === 1) return { kind: "help", command: null };
    if (argv.length > 2) {
      throw new CliUsageError("The help command accepts at most one command name.");
    }
    const requested = argv[1];
    if (requested === "help") return { kind: "help", command: null };
    if (!requested || !["serve", "restart", "completion"].includes(requested)) {
      const suggestion = requested ? nearestValue(requested, commandNames) : null;
      throw new CliUsageError(
        `Unknown command '${requested ?? ""}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
      );
    }
    return { kind: "help", command: requested as CliCommandName };
  }

  if (
    first &&
    !first.startsWith("-") &&
    !commandNames.includes(first as (typeof commandNames)[number])
  ) {
    const suggestion = nearestValue(first, commandNames);
    throw new CliUsageError(
      `Unknown command '${first}'.${suggestion ? ` Did you mean '${suggestion}'?` : " Repository paths must follow 'serve' or '--repo'."}`,
    );
  }

  if (first === "restart") {
    const commandArgv = argv.slice(1);
    const parsed = parseRestartArguments(commandArgv);
    if (parsed.help) return { kind: "help", command: "restart" };
    if (parsed.version) return { kind: "version" };
    return { kind: "restart", argv: commandArgv, parsed };
  }

  if (first === "completion") {
    const parsed = parseCompletionArguments(argv.slice(1));
    if (parsed.help) return { kind: "help", command: "completion" };
    if (parsed.version) return { kind: "version" };
    if (!parsed.shell) {
      throw new CliUsageError("A shell is required: zsh, bash, or fish.", "completion");
    }
    return { kind: "completion", shell: parsed.shell, install: parsed.install };
  }

  const explicitServe = first === "serve";
  const commandArgv = explicitServe ? argv.slice(1) : argv;
  const parsed = parseServeArguments(commandArgv, explicitServe);
  if (parsed.help) return { kind: "help", command: first === "serve" ? "serve" : null };
  if (parsed.version) return { kind: "version" };
  return { kind: "serve", argv: canonicalServeArguments(parsed), parsed };
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? Number.POSITIVE_INFINITY;
}

function nearestValue(value: string, candidates: readonly string[]): string | null {
  let nearest: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestPrefixLength = -1;
  for (const candidate of candidates) {
    const normalizedValue = value.toLowerCase();
    const normalizedCandidate = candidate.toLowerCase();
    const distance = editDistance(normalizedValue, normalizedCandidate);
    let prefixLength = 0;
    while (
      normalizedValue[prefixLength] !== undefined &&
      normalizedValue[prefixLength] === normalizedCandidate[prefixLength]
    ) {
      prefixLength += 1;
    }
    if (distance < nearestDistance || (distance === nearestDistance && prefixLength > nearestPrefixLength)) {
      nearest = candidate;
      nearestDistance = distance;
      nearestPrefixLength = prefixLength;
    }
  }
  if (!nearest) return null;
  const comparisonLength = Math.max(value.length, nearest.length);
  return nearestDistance <= 2 && nearestDistance <= Math.ceil(comparisonLength / 3)
    ? nearest
    : null;
}

function optionSyntax(option: CliOptionDefinition): string {
  const value = option.valueName ? ` <${option.valueName}>` : "";
  return `${option.short ? `-${option.short}, ` : "    "}--${option.name}${value}`;
}

function renderOptionList(options: readonly CliOptionDefinition[]): string {
  const entries = options.map((option) => [optionSyntax(option), option.description] as const);
  const width = Math.max(...entries.map(([syntax]) => syntax.length));
  return entries
    .map(([syntax, description]) => `  ${syntax.padEnd(width)}  ${description}`)
    .join("\n");
}

export function renderCliHelp(command: CliCommandName | null): string {
  if (command === null) {
    return `Couchview ${CLI_VERSION}
A local-first Git diff review PWA powered by Bun.

Usage:
  couchview [options]
  couchview serve [repository] [options]
  couchview restart [options]
  couchview completion <shell> [--install]
  couchview help [command]

Commands:
  serve       Start Couchview or add a repository to the running server.
  restart     Rebuild and restart the running production server.
  completion  Print a zsh, bash, or fish completion script.
  help        Show general or command-specific help.

Global options:
${renderOptionList(optionDefinitions.filter((option) => option.name === "help" || option.name === "version"))}

Run 'couchview help <command>' for command-specific options and examples.`;
  }

  if (command === "restart") {
    return `Restart the running Couchview production server.

Usage:
  couchview restart [options]

Options:
${renderOptionList(optionsFor("restart"))}

Environment:
  COUCHVIEW_HOST  Default server address (default: 127.0.0.1).
  PORT            Default server port (default: 4173).

Example:
  couchview restart --host 127.0.0.1 --port 4173`;
  }

  if (command === "completion") {
    return `Print a shell completion script or install it for Fish.

Usage:
  couchview completion <zsh|bash|fish> [--install]

Options:
${renderOptionList(optionsFor("completion"))}

Examples:
  source <(couchview completion zsh)
  source <(couchview completion bash)
  couchview completion fish | source
  couchview completion fish --install`;
  }

  return `Start Couchview or add a repository to the running server.

Usage:
  couchview [options]
  couchview serve [repository] [options]

Options:
${renderOptionList(optionsFor("serve"))}

Environment:
  COUCHVIEW_ROOT           Default repository path.
  COUCHVIEW_HOST           Default bind address (default: 127.0.0.1).
  PORT                     Default HTTP port (default: 4173).
  COUCHVIEW_TERMINAL       Set terminal access to 1 or 0.
  COUCHVIEW_TERMINAL_P2P   Set direct terminal P2P to 1 or 0.
  COUCHVIEW_TERMINAL_STUN  One to four comma-separated STUN URLs.
  COUCHVIEW_ALLOWED_ORIGINS
                           Trusted reverse-proxy origins; no wildcards.
  STATIC_DIR               Override the production asset directory.

Examples:
  couchview
  couchview --repo ../project --port 4173
  couchview serve ../project --port 4173
  couchview --interactive
  couchview --host 0.0.0.0 --enable-terminal

Security:
  Binding beyond loopback exposes repository controls to the network. Terminal
  access controls tmux with your OS-user permissions; direct P2P can disclose
  peer addresses and sends terminal payloads outside a configured proxy.`;
}

export function fishCompletionPath(
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string {
  const configuredHome = environment.XDG_CONFIG_HOME;
  const configHome = configuredHome && path.isAbsolute(configuredHome)
    ? configuredHome
    : path.join(userHome, ".config");
  return path.join(configHome, "fish", "completions", "couchview.fish");
}

function optionWords(command: CliCommandName): string {
  return optionsFor(command)
    .flatMap((option) => [
      `--${option.name}`,
      ...(option.short ? [`-${option.short}`] : []),
    ])
    .join(" ");
}

function zshOptionSpec(option: CliOptionDefinition): string {
  const names = option.short ? `{-${option.short},--${option.name}}` : `--${option.name}`;
  const escapedDescription = option.description.replaceAll("'", "");
  const value = option.valueName
    ? `:${option.valueName}:${option.completion === "directory" ? "_directories" : ""}`
    : "";
  return `'${names}[${escapedDescription}]${value}'`;
}

function renderZshCompletion(): string {
  const specs = (command: CliCommandName) => optionsFor(command).map(zshOptionSpec).join(" \\\n    ");
  return `#compdef couchview

_couchview() {
  local command=serve
  local explicit_command=0

  if (( CURRENT == 2 )) && [[ $PREFIX != -* ]]; then
    _describe 'command' '(serve restart completion help)'
    return
  fi

  case $words[2] in
    serve|restart|completion|help)
      command=$words[2]
      explicit_command=1
      words=($words[1] $words[3,-1])
      (( CURRENT-- ))
      ;;
  esac

  case $command in
    restart)
      _arguments ${specs("restart")}
      ;;
    completion)
      _arguments ${specs("completion")} \\
        '1:shell:(zsh bash fish)'
      ;;
    help)
      _arguments '1:command:(serve restart completion)'
      ;;
    serve)
      if (( explicit_command )); then
        _arguments ${specs("serve")} \\
          '1:repository directory:_directories'
      else
        _arguments ${specs("serve")}
      fi
      ;;
  esac
}

compdef _couchview couchview`;
}

function renderBashCompletion(): string {
  return `# bash completion for couchview
_couchview() {
  local cur prev command value index
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  command="serve"

  if (( COMP_CWORD > 1 )); then
    case "\${COMP_WORDS[1]}" in
      serve|restart|completion|help) command="\${COMP_WORDS[1]}" ;;
    esac
  fi

  if [[ "$command" == "serve" && ( "$prev" == "--repo" || "$prev" == "-r" ) ]]; then
    COMPREPLY=( $(compgen -d -- "$cur") )
    compopt -o filenames 2>/dev/null || true
    return
  fi

  if [[ "$command" == "serve" && "$cur" == --repo=* ]]; then
    value="\${cur#--repo=}"
    COMPREPLY=( $(compgen -d -- "$value") )
    for index in "\${!COMPREPLY[@]}"; do
      COMPREPLY[index]="--repo=\${COMPREPLY[index]}"
    done
    compopt -o filenames 2>/dev/null || true
    return
  fi

  if [[ "$cur" == -* ]]; then
    case "$command" in
      restart) COMPREPLY=( $(compgen -W '${optionWords("restart")}' -- "$cur") ) ;;
      completion) COMPREPLY=( $(compgen -W '${optionWords("completion")}' -- "$cur") ) ;;
      help) COMPREPLY=() ;;
      serve) COMPREPLY=( $(compgen -W '${optionWords("serve")}' -- "$cur") ) ;;
    esac
    return
  fi

  case "$command" in
    completion)
      COMPREPLY=( $(compgen -W 'zsh bash fish' -- "$cur") )
      ;;
    help)
      COMPREPLY=( $(compgen -W 'serve restart completion' -- "$cur") )
      ;;
    serve)
      if (( COMP_CWORD == 1 )); then
        COMPREPLY=( $(compgen -W 'serve restart completion help ${optionWords("serve")}' -- "$cur") )
      elif [[ "\${COMP_WORDS[1]}" == "serve" ]]; then
        COMPREPLY=( $(compgen -d -- "$cur") )
        compopt -o filenames 2>/dev/null || true
      fi
      ;;
  esac
}

complete -F _couchview couchview`;
}

function fishOptionLines(command: CliCommandName): string {
  return optionsFor(command).map((option) => {
    const short = option.short ? ` -s ${option.short}` : "";
    const requiresValue = option.type === "string" ? " -r" : "";
    const values = option.completion === "directory"
      ? " -f -a '(__fish_complete_directories)'"
      : "";
    return `complete -c couchview -n '__fish_couchview_using_command ${command}'${short} -l ${option.name}${requiresValue}${values} -d '${option.description}'`;
  }).join("\n");
}

function renderFishCompletion(): string {
  return `# fish completion for couchview
complete -c couchview -e
complete -c couchview -f

function __fish_couchview_command
  set -l words (commandline -opc)
  if test (count $words) -ge 2
    switch $words[2]
      case serve restart completion help
        echo $words[2]
        return
    end
  end
  echo serve
end

function __fish_couchview_using_command
  test (__fish_couchview_command) = $argv[1]
end

function __fish_couchview_using_explicit_command
  set -l words (commandline -opc)
  test (count $words) -ge 2; and test $words[2] = $argv[1]
end

complete -c couchview -n 'test (count (commandline -opc)) -le 1' -a serve -d 'Start Couchview'
complete -c couchview -n 'test (count (commandline -opc)) -le 1' -a restart -d 'Restart the running server'
complete -c couchview -n 'test (count (commandline -opc)) -le 1' -a completion -d 'Print shell completion'
complete -c couchview -n 'test (count (commandline -opc)) -le 1' -a help -d 'Show command help'

${fishOptionLines("serve")}
complete -c couchview -n '__fish_couchview_using_explicit_command serve' -f -a '(__fish_complete_directories)' -d 'Repository directory'

${fishOptionLines("restart")}

${fishOptionLines("completion")}
complete -c couchview -n '__fish_couchview_using_command completion' -f -a 'zsh bash fish' -d 'Shell'

complete -c couchview -n '__fish_couchview_using_command help' -f -a 'serve restart completion' -d 'Command'`;
}

export function renderCompletion(shell: CompletionShell): string {
  if (shell === "zsh") return renderZshCompletion();
  if (shell === "bash") return renderBashCompletion();
  return renderFishCompletion();
}

export interface InteractivePrompter {
  isTTY: boolean;
  question(message: string): Promise<string>;
  error(message: string): void;
  close(): void;
}

export interface InteractiveServeDefaults {
  root: string;
  host: string;
  port: number;
  terminalMode: "auto" | "enabled" | "disabled";
  terminalP2pMode: "auto" | "enabled" | "disabled";
}

interface InteractiveValidators {
  root(value: string): string;
  host(value: string): string;
  port(value: string): number;
}

export function createInteractivePrompter(): InteractivePrompter {
  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  readline.on("SIGINT", () => {
    readline.close();
  });
  return {
    isTTY,
    async question(message) {
      try {
        return await readline.question(message);
      } catch {
        throw new CliPromptInterrupted();
      }
    },
    error(message) {
      process.stderr.write(`${message}\n`);
    },
    close() {
      readline.close();
    },
  };
}

async function askValidated<T>(
  prompter: InteractivePrompter,
  label: string,
  defaultValue: string,
  validate: (value: string) => T,
): Promise<T> {
  while (true) {
    const answer = (await prompter.question(`${label} [${defaultValue}]: `)).trim();
    try {
      return validate(answer || defaultValue);
    } catch (error) {
      prompter.error((error as Error).message);
    }
  }
}

type TerminalChoice = "automatic" | "disabled" | "websocket" | "p2p";

function defaultTerminalChoice(defaults: InteractiveServeDefaults): TerminalChoice {
  if (defaults.terminalP2pMode === "enabled") return "p2p";
  if (defaults.terminalMode === "disabled") return "disabled";
  if (defaults.terminalMode === "enabled") return "websocket";
  return "automatic";
}

function parseTerminalChoice(value: string): TerminalChoice {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, TerminalChoice> = {
    "1": "automatic",
    a: "automatic",
    auto: "automatic",
    automatic: "automatic",
    "2": "disabled",
    d: "disabled",
    disabled: "disabled",
    "3": "websocket",
    w: "websocket",
    websocket: "websocket",
    "4": "p2p",
    p: "p2p",
    p2p: "p2p",
  };
  const choice = aliases[normalized];
  if (!choice) {
    throw new Error("Choose automatic, disabled, websocket, or p2p.");
  }
  return choice;
}

function terminalArguments(
  terminalMode: InteractiveServeDefaults["terminalMode"],
  terminalP2pMode: InteractiveServeDefaults["terminalP2pMode"],
): string[] {
  return [
    ...(terminalMode === "enabled"
      ? ["--enable-terminal"]
      : terminalMode === "disabled"
        ? ["--disable-terminal"]
        : []),
    ...(terminalP2pMode === "enabled"
      ? ["--enable-terminal-p2p"]
      : terminalP2pMode === "disabled"
        ? ["--disable-terminal-p2p"]
        : []),
  ];
}

export async function promptForServeArguments(
  parsed: ParsedServeArguments,
  defaults: InteractiveServeDefaults,
  prompter: InteractivePrompter,
  validators: InteractiveValidators,
): Promise<string[]> {
  if (!prompter.isTTY) {
    throw new CliUsageError(
      "--interactive requires an attached terminal; remove it when running non-interactively.",
      "serve",
    );
  }

  const root = parsed.explicit.repo
    ? defaults.root
    : await askValidated(prompter, "Repository", defaults.root, validators.root);
  const host = parsed.explicit.host
    ? defaults.host
    : await askValidated(prompter, "Host", defaults.host, validators.host);
  const port = parsed.explicit.port
    ? defaults.port
    : await askValidated(prompter, "Port", String(defaults.port), validators.port);

  let terminal = terminalArguments(defaults.terminalMode, defaults.terminalP2pMode);
  if (!parsed.explicit.terminal) {
    const defaultChoice = defaultTerminalChoice(defaults);
    const choice = await askValidated(
      prompter,
      "Terminal (automatic/disabled/websocket/p2p)",
      defaultChoice,
      parseTerminalChoice,
    );
    terminal = choice === "automatic"
      ? []
      : choice === "disabled"
        ? ["--disable-terminal", "--disable-terminal-p2p"]
        : choice === "websocket"
          ? ["--enable-terminal", "--disable-terminal-p2p"]
          : ["--enable-terminal", "--enable-terminal-p2p"];
  }

  return [
    "--repo",
    root,
    "--host",
    host,
    "--port",
    String(port),
    ...terminal,
  ];
}
