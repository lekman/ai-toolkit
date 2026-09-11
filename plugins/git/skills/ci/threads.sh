#!/usr/bin/env bash
# The review-thread half of the loop: list what is open, answer it, resolve it.
#
# Usage:
#   threads.sh list [pr]                       unresolved threads: thread id, comment id, where, who, what
#   threads.sh reply <comment-id> <thread-id> <body...>   reply on the thread, then resolve it
#   threads.sh resolve <thread-id>             resolve without replying (only after a reply exists)
#   threads.sh amend <reply-id> <body...>      rewrite a reply, for the commit that landed after an amend
#   threads.sh replies [pr]                    your own replies with their ids, for when they were not kept
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
		# A thread whose first comment is hidden prints "-" for the comment id:
		# a thread for the browser, not one to reply to from this list.
		printf '%s' "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not) | (.comments.nodes[0] // {}) as $c | "\(.id)\t\($c.databaseId // "-")\t\(.path):\(.line // .originalLine // "file")\(if .isOutdated then " (outdated)" else "" end)\t\($c.author.login // "hidden")\t\(($c.body // "") | gsub("[[:space:]]+";" ") | .[0:140])"'
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
	# The reply's own id is printed: keep it until the push lands, since the
	# list hides resolved threads and a later PATCH of the SHA needs it.
	gh api -X POST "repos/$REPO/pulls/$N/comments/$COMMENT/replies" -F body=@- --jq '"replied id=\(.id) \(.html_url)"' <<<"$BODY"
	gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t="$THREAD" --jq '"resolved \(.data.resolveReviewThread.thread.isResolved)"'
	;;
replies)
	N=$(gh pr view ${1:+"$1"} --repo "$REPO" --json number --jq .number)
	ME=$(gh api user --jq .login)
	gh api --paginate "repos/$REPO/pulls/$N/comments" --jq ".[] | select(.in_reply_to_id != null and .user.login == \"$ME\") | \"\(.id)\t\(.path)\t\(.body | gsub(\"[[:space:]]+\";\" \") | .[0:100])\""
	;;
amend)
	REPLY_ID=${1:?reply id}
	shift
	gh api -X PATCH "repos/$REPO/pulls/comments/$REPLY_ID" -F body=@- --jq '"amended \(.html_url)"' <<<"$*"
	;;
resolve)
	THREAD=${1:?thread id}
	gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t="$THREAD" --jq '"resolved \(.data.resolveReviewThread.thread.isResolved)"'
	;;
*)
	sed -n '2,13p' "$0"
	exit 2
	;;
esac
