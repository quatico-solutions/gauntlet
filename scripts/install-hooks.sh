#!/usr/bin/env bash
# Install local git hooks for this repository.
#
# Idempotent: re-running rewrites the hook. Safe to run from anywhere
# inside the working tree; resolves the actual git dir via `git rev-parse`
# so it works correctly inside worktrees (where .git is a file, not a
# directory).
#
# Run automatically by `bun install` via the package.json "prepare"
# script, and may be invoked manually:
#
#     bun run install-hooks
#
# To bypass an installed hook on a single commit, use `git commit
# --no-verify`. Don't make that a habit — the gate exists because the
# typecheck broke silently on main once.

set -euo pipefail

# Resolve the actual hooks directory (handles worktrees correctly).
HOOKS_DIR="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS_DIR"

PRE_COMMIT="$HOOKS_DIR/pre-commit"

cat > "$PRE_COMMIT" <<'HOOK'
#!/usr/bin/env bash
# Auto-installed by scripts/install-hooks.sh. Do not edit; changes will be
# overwritten by the next `bun install` / `bun run install-hooks`.
#
# Runs `bun run typecheck` before every commit. Fast (~1s) and catches
# the class of regression that escaped the repo's first silent-break:
# `tsc` red while tests + UI build stay green.
#
# For the full pipeline (typecheck + UI typecheck + UI build + tests),
# see the GitHub Actions workflow `.github/workflows/check.yml`.
#
# Bypass with `git commit --no-verify` when intentional (mid-rebase,
# WIP commit you'll squash, etc.).

set -e

# Find the repo root so the hook works regardless of cwd.
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Skip during rebase / cherry-pick / merge resolution — those workflows
# legitimately produce intermediate states that may not typecheck.
GIT_DIR="$(git rev-parse --git-dir)"
if [ -d "$GIT_DIR/rebase-merge" ] || [ -d "$GIT_DIR/rebase-apply" ] || \
   [ -f "$GIT_DIR/CHERRY_PICK_HEAD" ] || [ -f "$GIT_DIR/MERGE_HEAD" ]; then
  exit 0
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "pre-commit: bun not found on PATH; skipping typecheck guard." >&2
  exit 0
fi

echo "pre-commit: bun run typecheck"
if ! bun run typecheck; then
  echo "" >&2
  echo "pre-commit: typecheck failed — commit rejected." >&2
  echo "Fix the errors above, or bypass intentionally with --no-verify." >&2
  exit 1
fi
HOOK

chmod +x "$PRE_COMMIT"
echo "installed: $PRE_COMMIT"
