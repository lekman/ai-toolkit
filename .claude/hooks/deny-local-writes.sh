#!/bin/sh
# PreToolUse guard wrapper (shared-mode write guard).
#
# Entry point wired in .claude/settings.local.json. Runs deny-local-writes.mjs
# under a JS runtime, trying node first (near-universal), then bun. The hook is
# dependency-free ESM, so both runtimes execute it unchanged: there is no build
# step and no transpiled artifact to drift from the source.
#
# POSIX sh on purpose: it must run even under a minimal shell.
#
# Node first, bun fallback — and the fallback matters. This guard fails open when
# no runtime can run it, and node is present far more often than bun, so trying
# node first shrinks the window in which the guard silently does nothing. But a
# stale node on PATH (too old for .mjs) would crash; rather than let that mask a
# working bun, a non-zero exit from one runtime moves on to the next. The hook
# always exits 0 for BOTH allow and deny (deny is signalled by the JSON it
# prints), so a non-zero exit reliably means "this runtime could not run it".
#
# Fail open. This is an OPT-IN guard. If every candidate runtime is missing or
# fails, exit 0 (defer to the normal permission flow) rather than block every
# edit. A broken guard must never wedge the session.
#
# See security/isolated/README.md, "Shared mode: worktree write-guard".

set -eu

HOOK_DIR=$(dirname -- "$0")
HOOK_DIR=$(cd -- "$HOOK_DIR" && pwd)
JS_FILE="$HOOK_DIR/deny-local-writes.mjs"

# Read the hook input once so we can replay it to each candidate runtime.
INPUT=$(cat)

# Resolve a runtime by name, falling back to common install locations and the
# mise shim directory, because a hook may run with a minimal PATH. Prints the
# path (or nothing if not found).
resolve() {
  name=$1
  shift
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return 0
  fi
  for c in "$@"; do
    if [ -x "$c" ]; then
      echo "$c"
      return 0
    fi
  done
  return 0
}

NODE=$(resolve node "$HOME/.local/share/mise/shims/node" /opt/homebrew/bin/node /usr/local/bin/node)
BUN=$(resolve bun "$HOME/.bun/bin/bun" "$HOME/.local/share/mise/shims/bun" /opt/homebrew/bin/bun)

# Bound each attempt so a hung runtime cannot stall the tool call; on timeout the
# attempt fails and we try the next runtime (or fail open). Use timeout/gtimeout
# when present, otherwise run unbounded.
TIMEOUT=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT="timeout 5"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT="gtimeout 5"
fi

# Try node, then bun. The first runtime that exits 0 wins: forward its stdout
# verbatim (the deny JSON on the block path, or nothing on the allow path) and
# stop. If a runtime exits non-zero it could not run the hook, so move on.
for RUNTIME in "$NODE" "$BUN"; do
  [ -n "$RUNTIME" ] || continue
  if OUTPUT=$(printf '%s' "$INPUT" | $TIMEOUT "$RUNTIME" "$JS_FILE" 2>/dev/null); then
    printf '%s' "$OUTPUT"
    exit 0
  fi
done

# No runtime could run the guard: fail open.
exit 0
