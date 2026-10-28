#!/usr/bin/env bash
# SessionStart hook for the "compact" matcher. Claude Code adds whatever this
# prints to the context that follows a compaction. It prints two things:
#   - the working-state file .tmp/session-state.md, when the session keeps one,
#     so state written to disk outlives the summary;
#   - the path of the full transcript, so detail the summary dropped can be
#     searched instead of redone.
# It prints nothing when there is neither, and never fails the session.

input=$(cat 2>/dev/null || true)
transcript=$(printf '%s' "$input" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
state="${SESSION_STATE_FILE:-.tmp/session-state.md}"

if [ -f "$state" ]; then
  echo "The conversation was just compacted. This session keeps its working state in $state; it follows. Trust it over the summary where they differ, and keep it up to date."
  echo
  cat "$state"
  echo
fi

if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  echo "The full transcript from before the compaction is at $transcript (JSON lines). Search it with grep for exact details the summary dropped, such as file paths, error text or what was already ruled out. Do not read it whole."
fi

exit 0
