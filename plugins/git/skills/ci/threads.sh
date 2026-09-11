#!/usr/bin/env bash
# The review-thread half of the loop: list what is open, answer it, resolve it.
#
# Usage:
#   threads.sh list [pr]                       unresolved threads: thread id, comment id, where, who, what
#   threads.sh reply <comment-id> <thread-id> <body...>   reply on the thread, then resolve it
#   threads.sh resolve <thread-id>             resolve without replying (only after a reply exists)
#
# The comment id is the first comment of the thread (REST); the thread id is
# GraphQL's. `list` prints both so `reply` can be pasted from it.
# Environment: GREEN_REPO (owner/name, else the current repository).
set -euo pipefail

REPO=${GREEN_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
OWNER=${REPO%%/*}
NAME=${REPO##*/}
CMD=${1:-list}
shift || true

case "$CMD" in
list)
	N=$(gh pr view ${1:+"$1"} --repo "$REPO" --json number --jq .number)
	CURSOR=""
	while :; do
		PAGE=$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!,$c:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line originalLine comments(first:1){nodes{databaseId author{login} body}}}}}}}' \
			-f o="$OWNER" -f r="$NAME" -F n="$N" ${CURSOR:+-f c="$CURSOR"})
		printf '%s' "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not) | "\(.id)\t\(.comments.nodes[0].databaseId)\t\(.path):\(.line // .originalLine)\(if .isOutdated then " (outdated)" else "" end)\t\(.comments.nodes[0].author.login)\t\(.comments.nodes[0].body | gsub("\n";" ") | .[0:140])"'
		MORE=$(printf '%s' "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')
		CURSOR=$(printf '%s' "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // ""')
		[ "$MORE" = "true" ] || break
	done
	;;
reply)
	COMMENT=${1:?comment id}
	THREAD=${2:?thread id}
	shift 2
	BODY="$*"
	[ -n "$BODY" ] || {
		echo "a reply needs a body: what changed and the commit, or why not" >&2
		exit 2
	}
	N=$(gh api "repos/$REPO/pulls/comments/$COMMENT" --jq .pull_request_url | grep -oE '[0-9]+$')
	gh api -X POST "repos/$REPO/pulls/$N/comments/$COMMENT/replies" -f body="$BODY" --jq '"replied \(.html_url)"'
	gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t="$THREAD" --jq '"resolved \(.data.resolveReviewThread.thread.isResolved)"'
	;;
resolve)
	THREAD=${1:?thread id}
	gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t="$THREAD" --jq '"resolved \(.data.resolveReviewThread.thread.isResolved)"'
	;;
*)
	sed -n '2,11p' "$0"
	exit 2
	;;
esac
