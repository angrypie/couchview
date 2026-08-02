import { homedir } from "node:os";
import path from "node:path";

import { CLI_VERSION, type CliCommandName, type CompletionShell } from "./cliCommandTypes.ts";
import { type CliOptionDefinition, optionDefinitions, optionsFor } from "./cliOptions.ts";

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
  couchview bridge <pair|proxy|codex|terminal|claude> [options]
  couchview completion <shell> [--install]
  couchview help [command]

Commands:
  serve       Start Couchview or add a repository to the running server.
  restart     Rebuild and restart the running production server.
  bridge      Pair a native client or connect development tools through SSH.
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

	if (command === "bridge") {
		return `Pair a development device or connect development tools remotely.

Usage:
  couchview bridge pair --url <origin> --code <code> [--origin-access <provider>]
  couchview bridge proxy --profile <id>
  couchview bridge codex [--profile <id-or-host>] [--repo <absolute-path>] [-- <codex-arguments>]
  couchview bridge terminal [--profile <id-or-host>] [--repo <absolute-path>]
  couchview bridge claude [--profile <id-or-host>] [--repo <absolute-path>] [-- <claude-arguments>]

Options:
${renderOptionList(optionsFor("bridge"))}

The pair command stores a private device credential and installs a managed
OpenSSH host alias. The proxy command is invoked automatically by OpenSSH and
must not be run interactively. One pairing can open every repository registered
on that Couchview host. The terminal command opens the selected repository in
the remote account's login shell. The claude command starts Claude Code Remote
Control in that repository. The codex command keeps the Codex terminal UI on
this computer while Codex executes remotely. Verify the managed host with plain
ssh first; normal SSH host-key and login checks apply.`;
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
  COUCHVIEW_REMOTE_BRIDGE  Set native IDE bridge access to 1 or 0.
  COUCHVIEW_REMOTE_BRIDGE_P2P
                           Set direct IDE WebRTC transport to 1 or 0.
  COUCHVIEW_REMOTE_BRIDGE_STUN
                           One to four comma-separated STUN URLs.
  COUCHVIEW_REMOTE_BRIDGE_PORT
                           Loopback SSH port (default: 22).
  COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS
                           Pairing origin-access provider (default: auto).
  COUCHVIEW_ALLOWED_ORIGINS
                           Trusted reverse-proxy origins; no wildcards.
  STATIC_DIR               Override the production asset directory.

Examples:
  couchview
  couchview --repo ../project --port 4173
  couchview serve ../project --port 4173
  couchview --interactive
  couchview --host 0.0.0.0 --enable-terminal
  couchview --host 0.0.0.0 --enable-remote-bridge --enable-remote-bridge-p2p

Security:
  Binding beyond loopback exposes repository controls to the network. Terminal
  access controls tmux with your OS-user permissions; direct P2P can disclose
  peer addresses and sends terminal payloads outside a configured proxy. The
  native bridge is separately paired and can only reach loopback SSH.`;
}

export function fishCompletionPath(
	environment: NodeJS.ProcessEnv = process.env,
	userHome = homedir(),
): string {
	const configuredHome = environment.XDG_CONFIG_HOME;
	const configHome =
		configuredHome && path.isAbsolute(configuredHome)
			? configuredHome
			: path.join(userHome, ".config");
	return path.join(configHome, "fish", "completions", "couchview.fish");
}

function optionWords(command: CliCommandName): string {
	return optionsFor(command)
		.flatMap((option) => [`--${option.name}`, ...(option.short ? [`-${option.short}`] : [])])
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
	const specs = (command: CliCommandName) =>
		optionsFor(command).map(zshOptionSpec).join(" \\\n    ");
	return `#compdef couchview

_couchview() {
  local command=serve
  local explicit_command=0

  if (( CURRENT == 2 )) && [[ $PREFIX != -* ]]; then
    _describe 'command' '(serve restart bridge completion help)'
    return
  fi

  case $words[2] in
    serve|restart|bridge|completion|help)
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
      _arguments ${specs("completion")} \
        '1:shell:(zsh bash fish)'
      ;;
    bridge)
      _arguments ${specs("bridge")} \
        '1:action:(pair proxy codex terminal claude)'
      ;;
    help)
      _arguments '1:command:(serve restart bridge completion)'
      ;;
    serve)
      if (( explicit_command )); then
        _arguments ${specs("serve")} \
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
      serve|restart|bridge|completion|help) command="\${COMP_WORDS[1]}" ;;
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
      bridge) COMPREPLY=( $(compgen -W '${optionWords("bridge")}' -- "$cur") ) ;;
      help) COMPREPLY=() ;;
      serve) COMPREPLY=( $(compgen -W '${optionWords("serve")}' -- "$cur") ) ;;
    esac
    return
  fi

  case "$command" in
    completion)
      COMPREPLY=( $(compgen -W 'zsh bash fish' -- "$cur") )
      ;;
    bridge)
      COMPREPLY=( $(compgen -W 'pair proxy codex terminal claude' -- "$cur") )
      ;;
    help)
      COMPREPLY=( $(compgen -W 'serve restart bridge completion' -- "$cur") )
      ;;
    serve)
      if (( COMP_CWORD == 1 )); then
        COMPREPLY=( $(compgen -W 'serve restart bridge completion help ${optionWords("serve")}' -- "$cur") )
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
	return optionsFor(command)
		.map((option) => {
			const short = option.short ? ` -s ${option.short}` : "";
			const requiresValue = option.type === "string" ? " -r" : "";
			const values =
				option.completion === "directory" ? " -f -a '(__fish_complete_directories)'" : "";
			return `complete -c couchview -n '__fish_couchview_using_command ${command}'${short} -l ${option.name}${requiresValue}${values} -d '${option.description}'`;
		})
		.join("\n");
}

function renderFishCompletion(): string {
	return `# fish completion for couchview
complete -c couchview -e
complete -c couchview -f

function __fish_couchview_command
  set -l words (commandline -opc)
  if test (count $words) -ge 2
    switch $words[2]
      case serve restart bridge completion help
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
complete -c couchview -n 'test (count (commandline -opc)) -le 1' -a bridge -d 'Connect native tools through SSH'
complete -c couchview -n 'test (count (commandline -opc)) -le 1' -a completion -d 'Print shell completion'
complete -c couchview -n 'test (count (commandline -opc)) -le 1' -a help -d 'Show command help'

${fishOptionLines("serve")}
complete -c couchview -n '__fish_couchview_using_explicit_command serve' -f -a '(__fish_complete_directories)' -d 'Repository directory'

${fishOptionLines("restart")}

${fishOptionLines("bridge")}
complete -c couchview -n '__fish_couchview_using_command bridge' -f -a 'pair proxy codex terminal claude' -d 'Bridge action'

${fishOptionLines("completion")}
complete -c couchview -n '__fish_couchview_using_command completion' -f -a 'zsh bash fish' -d 'Shell'

complete -c couchview -n '__fish_couchview_using_command help' -f -a 'serve restart bridge completion' -d 'Command'`;
}

export function renderCompletion(shell: CompletionShell): string {
	if (shell === "zsh") return renderZshCompletion();
	if (shell === "bash") return renderBashCompletion();
	return renderFishCompletion();
}
