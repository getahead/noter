#!/bin/bash
# Finds what in Noter's ChatGPT-account test request (the sign-in sheet's Check step) the Codex
# installed on this Mac refuses (#1242). It lets Noter's adapter build the request against a
# stand-in that records it (arguments, environment, working directory, prompt, schema) without
# running Codex, then sends the recorded request to the real Codex: once exactly as recorded, then
# with ONE thing changed per run. Each line shows the exit code, the provider's HTTP status when
# Codex names one, and Codex's own error text with tokens, e-mails, ids and long strings removed.
# It never signs in or out. Each run spends one tiny request of the signed-in plan, and Codex may
# refresh its own sign-in, as it does in the app. The last variant runs in your own ~/.codex.
#   scripts/dev/codex-account-check.sh [path-to-codex]
set -u
cd "$(dirname "$0")/../.."
real=${1:-$(command -v codex || echo "$HOME/.local/bin/codex")}
[ -x "$real" ] || { echo "codex not found: pass its path as the first argument"; exit 2; }
check=target/debug/examples/account_check
[ -x "$check" ] || cargo build -q -p noter-llm --example account_check || exit 2
run=$(mktemp -d)
trap 'rm -rf "$run"' EXIT
rec=$run/rec
mkdir "$rec"

# The stand-in: answers the version, records the one `exec` and runs nothing.
cat > "$run/codex" <<SHIM
#!/bin/sh
case "\${1:-}" in
  --version) exec "$real" --version ;;
  exec)
    printf '%s\n' "\$@" > "$rec/args"
    /usr/bin/env > "$rec/env"
    /bin/pwd > "$rec/cwd"
    /bin/cat > "$rec/stdin"
    while [ \$# -gt 1 ]; do [ "\$1" = --output-schema ] && /bin/cp "\$2" "$rec/schema.json"; shift; done
    exit 0 ;;
  *) exit 1 ;;
esac
SHIM
chmod +x "$run/codex"
# the environment a Finder-started app has
env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    TMPDIR="${TMPDIR:-/tmp}" "$check" codex "$run/codex" "$run" > "$run/noter.out" 2>&1
[ -s "$rec/args" ] || { echo "Noter did not start Codex: $(cat "$run/noter.out")"; exit 1; }

args=(); while IFS= read -r a; do args+=("$a"); done < "$rec/args"
envs=(); while IFS= read -r e; do envs+=("$e"); done < <(grep -vE '^(PWD|OLDPWD|SHLVL|_)=' "$rec/env")
cwd=$(cat "$rec/cwd")
schema=; model="(none)"
for ((i = 0; i < ${#args[@]}; i++)); do
  [ "${args[i]}" = --output-schema ] && schema=${args[i+1]}
  [ "${args[i]}" = -m ] && model=${args[i+1]}
done

redact() {
  sed -E -e "s#$HOME#~#g" -e "s#$run#<run>#g" \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<email>/g' \
    -e 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<id>/g' \
    -e 's/(org|user|acct|req|sess|resp)[-_][A-Za-z0-9]{12,}/<id>/g' \
    -e 's/[A-Za-z0-9_+\/=-]{24,}/<redacted>/g'
}

# variant <name> <drop: a flag to leave out, with its value when it has one> [own-home]
variant() {
  local name=$1 drop=$2 own=${3:-} a=() e=("${envs[@]}") i
  for ((i = 0; i < ${#args[@]}; i++)); do
    if [ -n "$drop" ] && [ "${args[i]}" = "$drop" ]; then
      case $drop in -m | -c | --output-schema) i=$((i + 1)) ;; esac
      continue
    fi
    a+=("${args[i]}")
  done
  if [ -n "$own" ]; then
    e=(); for i in "${envs[@]}"; do case $i in HOME=* | CODEX_HOME=*) ;; *) e+=("$i") ;; esac; done
    e+=("HOME=$HOME" "CODEX_HOME=$HOME/.codex")
  fi
  # the run directory Noter removes after each run: the schema file and TMPDIR live in it
  mkdir -p "$(dirname "$schema")"
  if [ "$name" = 'schema without "$schema"' ]; then
    sed -E 's/"\$schema":"[^"]*",?//' "$rec/schema.json" > "$schema"
  else
    cp "$rec/schema.json" "$schema"
  fi
  local out=$run/out err=$run/err code status said
  (cd "$cwd" && env -i "${e[@]}" /usr/bin/perl -e 'alarm 120; exec @ARGV' "$real" "${a[@]}" \
    < "$rec/stdin" > "$out" 2> "$err")
  code=$?
  status=$(cat "$out" "$err" | grep -oE '(unexpected status |"api_error_status":|http[ _]?(status|error)[: ]+)[0-9]{3}' | tail -1 | grep -oE '[0-9]{3}$')
  # Codex's own error events and its last stderr lines; a model's answer is never an error event
  said=$( (grep -E '"type":"(error|turn\.failed)"' "$out" | sed -E 's/.*"message":"(([^"\\]|\\.)*)".*/\1/'; tail -3 "$err") |
    sed -E -e 's/^Reconnecting\.\.\. [0-9]+\/[0-9]+ //' -e 's/, cf-ray: [^)]*//' | awk '!seen[$0]++' |
    redact | tr '\n' ' ' | cut -c1-400)
  if [ "$code" = 0 ] && grep -q '"type":"turn.completed"' "$out"; then said="answered"; fi
  [ "$code" = 142 ] && said="no answer in 120 s. $said"
  printf '%-34s exit=%-3s http=%-4s %s\n' "$name" "$code" "${status:--}" "$said"
}

echo "Codex: $("$real" --version 2>&1 | head -1)   model Noter sends (-m): $model"
echo "arguments: $(printf '%s ' "${args[@]}" | redact)"
variant 'exactly as Noter sends it' ''
variant 'no -m (model)' -m
variant 'no --output-schema' --output-schema
variant 'schema without "$schema"' ''
variant 'no --ignore-rules' --ignore-rules
variant 'no --ignore-user-config' --ignore-user-config
variant 'no -c options' -c
variant 'your own HOME and ~/.codex' '' own
