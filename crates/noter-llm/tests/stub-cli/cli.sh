#!/bin/sh
# A stand-in for `claude` and `codex` in the run-lockdown tests (TL-14); no real CLI, no network.
# The test copies it into a directory of its own. Next to it: `version` (what --version prints),
# `mode` (ok | fail | hang) and `output.json` (the structured output to answer with).
# Each run writes record.<pid>: tab-separated `argv`, `env`, `cwd`, `cwd-file` (what the working
# directory holds), `stdin`, `copy` (a file named in argv and its content), `auth` (what CODEX_HOME's
# auth.json points at) and `loaded` (every config, hook, plugin, MCP or instruction file the real CLI
# would read with these flags, when it exists).
here=$(cd "$(dirname "$0")" && pwd)
if [ "$1" = "--version" ]; then
    cat "$here/version"
    exit 0
fi
rec="$here/record.$$"
out="$here/.record.$$"
: >"$out"
line() { printf '%s\t%s\n' "$1" "$2" >>"$out"; }

codex=no
[ "$1" = "exec" ] && codex=yes
bare=no strict=no ignore_user=no sources=unset resume=
prev=
for a in "$@"; do
    line argv "$a"
    case "$prev" in
    --mcp-config | --append-system-prompt-file | --output-schema)
        printf 'copy\t%s\t' "$a" >>"$out"
        tr '\n' ' ' <"$a" >>"$out"
        printf '\n' >>"$out"
        ;;
    --setting-sources) sources="$a" ;;
    --resume | resume) resume="$a" ;;
    esac
    case "$a" in
    --bare) bare=yes ;;
    --strict-mcp-config) strict=yes ;;
    --ignore-user-config) ignore_user=yes ;;
    esac
    prev="$a"
done
env | while IFS= read -r e; do line env "$e"; done
line cwd "$(pwd)"
for f in $(ls -A .); do line cwd-file "$f"; done

loads() { if [ -e "$1" ]; then line loaded "$1"; fi; }
has() { case ",$sources," in *",$1,"*) return 0 ;; esac; return 1; }
if [ $codex = yes ]; then
    home="${CODEX_HOME:-$HOME/.codex}"
    [ $ignore_user = no ] && loads "$home/config.toml"
    loads "$home/AGENTS.md"
    loads "$HOME/.codex/config.toml"
    loads "./AGENTS.md"
    if [ -L "$home/auth.json" ]; then line auth "$(readlink "$home/auth.json")"; fi
else
    # Claude Code: --bare skips hooks, plugins, CLAUDE.md and MCP discovery; otherwise
    # --setting-sources decides which settings and instructions load (all when unset).
    user=yes project=yes
    if [ $bare = yes ]; then
        user=no project=no
    elif [ "$sources" != unset ]; then
        has user || user=no
        has project || project=no
    fi
    if [ $user = yes ]; then
        loads "$HOME/.claude/settings.json"
        loads "$HOME/.claude/CLAUDE.md"
        loads "$HOME/.claude/plugins"
    fi
    if [ $project = yes ]; then
        loads "./.claude/settings.json"
        loads "./CLAUDE.md"
    fi
    if [ $strict = no ] && [ $bare = no ]; then
        loads "$HOME/.claude.json"
        loads "./.mcp.json"
    fi
fi

line stdin "$(cat)"
mv "$out" "$rec"
mode=$(cat "$here/mode")
if [ "$mode" = hang ]; then
    echo $$ >"$here/pid"
    exec sleep 60
fi
if [ "$mode" = fail ]; then
    echo "stub failure" >&2
    exit 1
fi
output=$(tr '\n' ' ' <"$here/output.json")
if [ $codex = yes ]; then
    printf '{"type":"thread.started","thread_id":"%s"}\n' "${resume:-thread-$$}"
    printf '{"type":"turn.started"}\n'
    text=$(printf '%s' "$output" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"%s"}}\n' "$text"
    printf '{"type":"turn.completed","usage":{"input_tokens":11,"cached_input_tokens":0,"output_tokens":7}}\n'
else
    printf '{"type":"result","subtype":"success","is_error":false,"result":"","session_id":"%s","total_cost_usd":0.02,"usage":{"input_tokens":11,"output_tokens":7},"structured_output":%s}\n' "${resume:-session-$$}" "$output"
fi
