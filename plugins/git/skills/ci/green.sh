#!/usr/bin/env bash
# Evaluate every mergeable condition for one pull request, in one command.
#
# Usage: green.sh [pr-number|branch] [--merge] [--admin] [--local] [--reviewer auto|claude|copilot|coderabbit|none]
#
# Prints one line per condition and exits 0 only when all of them hold. With
# --merge it merges on a pass, with the method the repository allows; --admin
# adds the bypass and is for an operator who has said so. Written because
# assembling these checks by hand is slow and, worse, easy to get subtly
# wrong: four of the conditions below have at some point reported green when
# they should not have, and every one of those failures was silent.
#
# Environment: GREEN_REPO (owner/name, else the current repository),
# GREEN_REVIEWER (as --reviewer), GREEN_ADMIN=1 (as --admin),
# GREEN_QUALITY_CMD (the local quality command, else detected),
# GREEN_ALLOW_FILE_GAP=1 (accept a Copilot review that covered fewer files).
set -uo pipefail

SEL=""
MERGE=0
ADMIN=${GREEN_ADMIN:-0}
LOCAL=0
REVIEWER=${GREEN_REVIEWER:-auto}
while [ $# -gt 0 ]; do
	case "$1" in
	--merge) MERGE=1 ;;
	--admin) ADMIN=1 ;;
	--local) LOCAL=1 ;;
	--reviewer)
		REVIEWER="${2:-auto}"
		shift
		;;
	-h | --help)
		sed -n '2,15p' "$0"
		exit 0
		;;
	*) SEL="$1" ;;
	esac
	shift
done

REPO=${GREEN_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)}
[ -n "$REPO" ] || {
	echo "not inside a GitHub repository and GREEN_REPO is unset"
	exit 2
}
OWNER=${REPO%%/*}
NAME=${REPO##*/}
OK=1
say() { printf '%-22s %s\n' "$1" "$2"; }
fail() { OK=0; }

# Accept a number, a branch name, or nothing (the current branch). gh resolves
# all three, so the script never has to guess which was meant.
N=$(gh pr view ${SEL:+"$SEL"} --repo "$REPO" --json number --jq .number 2>/dev/null)
[ -n "$N" ] || {
	echo "no pull request for: ${SEL:-the current branch}"
	exit 2
}
HEAD=$(gh pr view "$N" --repo "$REPO" --json headRefOid,isDraft --jq .headRefOid)
DRAFT=$(gh pr view "$N" --repo "$REPO" --json isDraft --jq .isDraft)
echo "PR $N in $REPO  head=${HEAD:0:8}"
if [ "$DRAFT" = "true" ]; then
	say "0 draft" "FAIL  (still a draft)"
	fail
fi

# 1. Threads. Paginated to the end: zero unresolved out of a truncated page
#    is not zero unresolved.
UNRES=0
TOTAL=0
CURSOR=""
while :; do
	PAGE=$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!,$c:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$c){totalCount pageInfo{hasNextPage endCursor} nodes{isResolved}}}}}' \
		-f o="$OWNER" -f r="$NAME" -F n="$N" ${CURSOR:+-f c="$CURSOR"} \
		--jq '.data.repository.pullRequest.reviewThreads | "\([.nodes[]|select(.isResolved==false)]|length) \(.totalCount) \(.pageInfo.hasNextPage) \(.pageInfo.endCursor // "")"') || break
	read -r U T MORE CURSOR <<<"$PAGE"
	UNRES=$((UNRES + U))
	TOTAL=$T
	[ "$MORE" = "true" ] || break
done
if [ "$UNRES" = "0" ]; then
	say "1 threads" "PASS  ($TOTAL total, 0 unresolved)"
else
	say "1 threads" "FAIL  ($UNRES unresolved of $TOTAL; run threads.sh list $N)"
	fail
fi

# 2. The reviewer has reviewed the head commit, and the review is real.
#    Each reviewer leaves a different trace, so each has its own check.
BOTS=$(
	gh api --paginate "repos/$REPO/pulls/$N/reviews" --jq '.[]|select(.user.type=="Bot")|.user.login' 2>/dev/null
	gh api --paginate "repos/$REPO/issues/$N/comments" --jq '.[]|select(.user.type=="Bot")|.user.login' 2>/dev/null
)
if [ "$REVIEWER" = "auto" ]; then
	if printf '%s\n' "$BOTS" | grep -qi '^claude'; then
		REVIEWER=claude
	elif printf '%s\n' "$BOTS" | grep -qi 'copilot'; then
		REVIEWER=copilot
	elif printf '%s\n' "$BOTS" | grep -qi 'coderabbit'; then
		REVIEWER=coderabbit
	else
		REVIEWER=none
	fi
fi
BODY=""
case "$REVIEWER" in
claude)
	# Claude Review runs as a workflow on the head commit and edits one summary
	# comment in place, so the run on the head SHA is the evidence, not the
	# comment's timestamp.
	RUN=$(gh run list --repo "$REPO" -c "$HEAD" --json name,status,conclusion --jq '[.[]|select(.name|test("claude";"i"))]|first|"\(.status) \(.conclusion)"' 2>/dev/null)
	case "$RUN" in
	"" | "null null") say "2 review on head" "FAIL  (claude: no run on the head yet)"; fail ;;
	"completed success") say "2 review on head" "PASS  (claude: run on head succeeded)" ;;
	completed*) say "2 review on head" "FAIL  (claude: run on head ended ${RUN#completed })"; fail ;;
	*) say "2 review on head" "FAIL  (claude: run ${RUN%% *})"; fail ;;
	esac
	BODY=$(gh api --paginate "repos/$REPO/issues/$N/comments" --jq '[.[]|select(.user.login|test("^claude"))]|last|.body // ""' 2>/dev/null)
	;;
copilot)
	# --paginate: without it `last` can miss the review on the head commit.
	BODY=$(gh api --paginate "repos/$REPO/pulls/$N/reviews" \
		--jq "[.[]|select(.user.login|test(\"[Cc]opilot\"))|select(.commit_id==\"$HEAD\")]|last|.body // \"\"")
	COUNTS=$(printf '%s' "$BODY" | grep -oE 'reviewed [0-9]+ out of [0-9]+ changed files' | head -1)
	if [ -z "$BODY" ]; then
		say "2 review on head" "FAIL  (copilot: none yet)"
		fail
	elif printf '%s' "$BODY" | grep -q 'encountered an error'; then
		# An error record is a review object with no review in it, and the
		# ruleset counts it. An empty commit moves the head and gets a real one.
		say "2 review on head" "FAIL  (copilot: reviewer errored, push to retrigger)"
		fail
	elif [ -n "$COUNTS" ]; then
		A=$(printf '%s' "$COUNTS" | grep -oE 'reviewed [0-9]+' | grep -oE '[0-9]+')
		T=$(printf '%s' "$COUNTS" | grep -oE 'of [0-9]+' | grep -oE '[0-9]+')
		if [ "$A" = "$T" ]; then
			say "2 review on head" "PASS  (copilot: $A/$T files)"
		elif [ "${GREEN_ALLOW_FILE_GAP:-}" = "1" ]; then
			say "2 review on head" "PASS  (copilot: $A/$T, gap allowed by GREEN_ALLOW_FILE_GAP)"
		else
			# A rename or a deletion carries nothing to review, but "often
			# benign" is not a thing a gate can decide. Name the file, then allow.
			say "2 review on head" "FAIL  (copilot: $A/$T; list the files, set GREEN_ALLOW_FILE_GAP=1 if the gap is a rename or deletion)"
			fail
		fi
	else
		say "2 review on head" "PASS  (copilot: overview form, no marker)"
	fi
	;;
coderabbit)
	BODY=$(gh api --paginate "repos/$REPO/pulls/$N/reviews" \
		--jq "[.[]|select(.user.login|test(\"coderabbit\";\"i\"))|select(.commit_id==\"$HEAD\")]|last|.body // \"\"")
	if [ -z "$BODY" ]; then
		say "2 review on head" "FAIL  (coderabbit: none yet)"
		fail
	else
		say "2 review on head" "PASS  (coderabbit: $(printf '%s' "$BODY" | grep -oE 'Actionable comments posted: [0-9]+' | head -1))"
	fi
	;;
none)
	say "2 review on head" "SKIP  (no AI reviewer has posted on this PR; only threads gate)"
	;;
*)
	echo "unknown reviewer: $REVIEWER"
	exit 2
	;;
esac

# 3. What the reviewer said outside the threads. Never a blocker, always
#    read: the more serious findings have arrived here more often than as
#    posted threads.
case "$REVIEWER" in
copilot)
	SUP=$(printf '%s' "$BODY" | sed -n '/Suppressed comments/,/<\/details>/p')
	;;
claude)
	SUP=$(printf '%s\n' "$BODY" | grep -E '^\| [0-9]+ |^#### |^### |^- \*\*|^\*\*[0-9]+\.' | head -40)
	;;
coderabbit)
	SUP=$(printf '%s\n' "$BODY" | grep -iE 'actionable|nitpick|outside diff|additional comments' | head -20)
	;;
*) SUP="" ;;
esac
if [ -n "$SUP" ]; then
	say "3 reviewer summary" "READ THIS"
	printf '%s\n' "$SUP" | sed 's/^/    /'
else
	say "3 reviewer summary" "none"
fi

# 4. Checks. A pending check has not failed and has not passed either, and a
#    cancelled one is a failure of the process even when nothing broke.
STATES=$(gh pr checks "$N" --repo "$REPO" --json bucket --jq \
	'"\([.[]|select(.bucket|IN("fail","cancel"))]|length) \([.[]|select(.bucket=="pending")]|length)"' 2>/dev/null || echo "? ?")
CF=${STATES%% *}
CP=${STATES##* }
if [ "$CF" = "0" ] && [ "$CP" = "0" ]; then
	say "4 checks" "PASS  (0 failing, 0 pending)"
else
	say "4 checks" "FAIL  ($CF failing or cancelled, $CP pending)"
	fail
fi

# 5. Local quality, on the exact tree about to be pushed. CI may pass with
#    warnings this does not. Detected, named, and run only with --local.
QUALITY=${GREEN_QUALITY_CMD:-}
if [ -z "$QUALITY" ]; then
	if [ -f Taskfile.yml ] && grep -qE '^\s+quality:' Taskfile.yml; then
		QUALITY="task quality"
		# Where a security sweep exists it is part of the pre-push hook too.
		grep -qE '^\s+security:' Taskfile.yml && QUALITY="task quality && task security"
	elif [ -f package.json ] && grep -q '"lint"' package.json; then
		QUALITY="bun run lint"
	fi
fi
if [ -z "$QUALITY" ]; then
	say "5 local quality" "SKIP  (no Taskfile quality task or lint script found; set GREEN_QUALITY_CMD)"
elif [ "$LOCAL" = "1" ]; then
	if bash -c "$QUALITY" >/tmp/green-quality.log 2>&1; then
		say "5 local quality" "PASS  ($QUALITY)"
	else
		say "5 local quality" "FAIL  ($QUALITY; see /tmp/green-quality.log)"
		fail
	fi
else
	say "5 local quality" "RUN   $QUALITY   (or pass --local)"
fi

# 6. Mergeable. BEHIND would merge without the branch ever seeing current
#    main, and DIRTY is an outright conflict.
MG=$(gh pr view "$N" --repo "$REPO" --json mergeable,mergeStateStatus --jq '"\(.mergeable)/\(.mergeStateStatus)"')
case "$MG" in
MERGEABLE/BEHIND | MERGEABLE/DIRTY)
	say "6 mergeable" "FAIL  ($MG; merge the default branch in, never rebase a shared branch)"
	fail
	;;
MERGEABLE/*) say "6 mergeable" "PASS  ($MG)" ;;
*)
	say "6 mergeable" "FAIL  ($MG)"
	fail
	;;
esac

if [ "$OK" = "1" ]; then
	echo "=> GREEN"
	if [ "$MERGE" = "1" ]; then
		METHOD=$(gh repo view "$REPO" --json squashMergeAllowed,mergeCommitAllowed --jq 'if .squashMergeAllowed then "--squash" elif .mergeCommitAllowed then "--merge" else "--rebase" end')
		# shellcheck disable=SC2086
		gh pr merge "$N" --repo "$REPO" $METHOD --delete-branch $([ "$ADMIN" = "1" ] && echo --admin) && echo "merged ($METHOD${ADMIN:+, admin})"
	fi
	exit 0
fi
echo "=> NOT GREEN"
exit 1
