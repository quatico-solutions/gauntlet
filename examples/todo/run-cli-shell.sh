#!/usr/bin/env bash
# Launcher for the Gauntlet CLI adapter. Sets up an isolated
# scratch dir, drops a `todo` shim into a private bin dir on
# PATH, then exec's an interactive bash so the agent can issue
# todo commands. State lives under the scratch dir.
#
# Why a PATH shim and not `export -f todo`: bash exported
# functions only survive bash-to-bash exec, and Gauntlet's CLI
# adapter invokes targets via `sh -c`, which on Linux is usually
# dash. A real shim script on PATH survives any shell exec.
set -e
SCRATCH="$(mktemp -d -t todo-card-XXXXXX)"
export TODO_STATE_FILE="$SCRATCH/state.json"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[[ -d "$REPO_ROOT/examples/todo" ]] || {
  echo "launcher: REPO_ROOT wrong: $REPO_ROOT" >&2; exit 1;
}
mkdir -p "$SCRATCH/bin"
cat >"$SCRATCH/bin/todo" <<EOF
#!/usr/bin/env bash
exec bun run "$REPO_ROOT/examples/todo/cli.ts" "\$@"
EOF
chmod +x "$SCRATCH/bin/todo"
export PATH="$SCRATCH/bin:$PATH"
export PS1="todo$ "
cd "$SCRATCH"
echo "todo fixture ready. state: $TODO_STATE_FILE"
# -i forces interactive mode (prompts emit on stdout, line editing on);
# --norc --noprofile keeps the env clean for reproducibility.
exec bash --norc --noprofile -i
