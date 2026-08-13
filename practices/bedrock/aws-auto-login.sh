#!/usr/bin/env bash
# SessionStart hook: keep the AWS SSO session valid for Claude Code on Bedrock.
#
# On session start, check whether the configured AWS profile still has a valid
# SSO token. If it does, do nothing. If it has expired or is missing, run
# `aws sso login` for that profile so the session self-authenticates instead of
# failing later with "Could not load credentials from any providers".
#
# This is the automatic equivalent of running `aws sso login` by hand. Prefer it
# over a manual step or a build-tool task: the refresh then happens on its own,
# only when the token is actually invalid, and stays silent otherwise.
#
# Design decisions:
#   - Fail open. This must never block a session from starting. If anything is
#     missing (no aws CLI, no profile, no timeout binary) or the login errors or
#     times out, the hook exits 0 and the normal flow continues; you can still
#     run `aws sso login` by hand.
#   - Opt-in. Wire this in your personal .claude/settings.local.json, not the
#     committed settings.json: `aws sso login` opens a browser tab for device
#     auth, and not everyone wants a popup on every new session.
#   - Interactive only. Device auth needs a browser, so this completes only where
#     a human can click. On a headless subagent, let it inherit a token an
#     interactive session already refreshed; do not expect it to log in itself.
#   - PATH is not guaranteed inside a hook. Probe common install locations for
#     the aws CLI before giving up.
#   - Bounded. `aws sso login` waits for the browser flow; a timeout stops a
#     hung login from stalling the session start.
#
# See practices/bedrock/README.md.

set -euo pipefail

PROFILE="${AWS_PROFILE:-}"
# No profile configured: nothing to keep alive. Defer to the normal flow.
[ -n "$PROFILE" ] || exit 0

# Locate the aws CLI. Prefer PATH; fall back to common locations because a hook
# may run with a minimal PATH.
find_aws() {
  if command -v aws >/dev/null 2>&1; then
    command -v aws
    return 0
  fi
  local candidate
  for candidate in \
    "/opt/homebrew/bin/aws" \
    "/usr/local/bin/aws" \
    "$HOME/.local/bin/aws"; do
    [ -x "$candidate" ] && {
      echo "$candidate"
      return 0
    }
  done
  return 1
}

# aws CLI not found: fail open.
AWS="$(find_aws)" || exit 0

# Token still valid: nothing to do, stay silent.
if "$AWS" sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1; then
  exit 0
fi

# Pick a timeout runner if the platform has one (stock macOS has neither).
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
fi

# Human-visible note in the terminal; the login opens a browser tab.
echo "[aws-auto-login] AWS SSO token for profile '$PROFILE' is missing or expired; running aws sso login (a browser tab will open)." >&2

# Run the login, bounded so a hung device-auth flow cannot stall the session.
# Fail open on any error or timeout.
if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" 120 "$AWS" sso login --profile "$PROFILE" >&2 2>&1 ||
    echo "[aws-auto-login] login did not complete; run 'aws sso login --profile $PROFILE' by hand if AWS calls fail." >&2
else
  "$AWS" sso login --profile "$PROFILE" >&2 2>&1 ||
    echo "[aws-auto-login] login did not complete; run 'aws sso login --profile $PROFILE' by hand if AWS calls fail." >&2
fi

exit 0
