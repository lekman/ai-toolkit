# Orchestrator and Subagents

**Practice:** run coding agents continuously without your daily machine by
splitting the work across two planes. An orchestrator plans and maintains the
backlog and never touches code. Disposable subagents do the code, on separate,
scoped, expiring credentials.

This is the operating model behind
[isolated-agent security](../security/isolated/README.md): that page protects one
checkout, this one describes how the whole thing runs.

## The Two Planes

|                      | Orchestrator                                                               | Subagent                                                           |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Runs                 | continuously, on a dedicated machine and OS account                        | on demand, one per unit of work                                    |
| Auth                 | your interactive subscription (Claude.ai / Max)                            | the cloud model provider over SSO (for example AWS Bedrock)        |
| Job                  | maintain the backlog, clone repos, launch and watch subagents, refresh SSO | write the code in an isolated checkout                             |
| Touches code?        | no                                                                         | yes                                                                |
| Credentials it holds | a project-management MCP (Jira, Monday, ...), read access                  | short-lived, IAM-scoped model credentials that expire on their own |

The orchestrator is the backlog maintainer. It reads the work from a system of
record over MCP, clones the repository each item touches, and starts a subagent
for the item. It does not edit code itself. If it did, a planning mistake could
land straight in a checkout.

Each subagent is headless and disposable. It authenticates to the model through
the cloud provider over SSO, works in an isolated checkout (a git worktree, see
the [write guard](../security/isolated/README.md)), and hands its result back for
review.

## Why Split the Auth Plane

This is the non-obvious part, and the reason the pattern earns its setup.

Orchestration and code execution have different risk, cost, and scope profiles,
so they get different credentials:

- **Orchestration** is interactive, low volume, and needs broad read plus MCP. It
  runs on an interactive subscription. It is the part you talk to.
- **Code execution** is the higher-risk, higher-volume part. It runs on the cloud
  provider with credentials that are scoped by IAM, expire on their own, and are
  tagged for per-team cost allocation.

So the credential that can run code is never the credential you use to think and
plan, and it expires without anyone remembering to revoke it. That is least
privilege and cheap revocation, applied to the agent's own identity rather than
to a human's.

## One OS Account per Client

The orchestrator runs under a dedicated operating-system account, one per client,
on a persistent machine you can reach remotely (see
[observability](../observability/README.md) for remote control). The account has
its own home, keychain, and credentials, and carries the client context in
environment variables so the orchestrator knows which backlog and repositories
are in scope. Client contexts never mix, and wiping one account touches nothing
else. This is [machine-level isolation](../security/machine/README.md) applied
per client.

## The SSO Lifecycle

Subagents cannot start without a valid cloud SSO session, and that session
expires after a few hours. The orchestrator owns the refresh: it re-runs the SSO
login before the token lapses, so a subagent never dies mid-task on an expired
credential. Nothing is pasted; the login refreshes on a timer the orchestrator
drives.

The [aws-auto-login hook](bedrock/aws-auto-login.sh) is one way to drive this on
the interactive session: it checks the token on session start and logs in only
when it has lapsed. It runs where a human can complete the browser device auth,
so it belongs on the orchestrator, not on a headless subagent. See
[bedrock](bedrock/README.md).

## Monitoring and Steering

The orchestrator watches subagent state (running, blocked, waiting on input,
failed) and intervenes. When a subagent stalls, drifts from the plan, or a check
fails, the orchestrator steers it back rather than letting it run open loop. Two
practices pair with this:

- **Goal plan and execute** ([plan](../plugins/goal/skills/plan/SKILL.md) /
  [execute](../plugins/goal/skills/execute/SKILL.md)): the plan is the contract.
  One identity executes the work, a separate identity verifies the plan was met.
  The orchestrator is where that separation is enforced.
- **[Observability](../observability/README.md)**: how you see the state and get
  notified when a subagent needs a human.

## The Blast Radius

Put together, a subagent's mistake is contained three times over. The
[worktree write guard](../security/isolated/README.md) keeps it out of the shared
checkout. The disposable OS account keeps it away from your other clients. The
scoped, expiring model credentials keep it from reaching anything the IAM role
does not grant. No layer is perfect; each one catches what the last missed. This
is [defence in depth](../security/README.md) applied to autonomous work.

## When Not to Use It

This is deliberate overhead. For a single interactive session on your own
machine it is too much: you do not need an orchestrator, a second machine,
per-client accounts, or cloud SSO. Reach for it when you run agents continuously
and unattended, across more than one client, and the cost of a mistake reaching
the wrong context is real.
