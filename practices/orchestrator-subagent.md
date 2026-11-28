# Orchestrator and Subagents

[ai-toolkit](../README.md) / [Practices](README.md)

**Practice:** run coding agents away from your daily machine by splitting the
work across two planes. An orchestrator plans and maintains the backlog and
never touches code. Disposable subagents do the code, each on one specified
unit of work, on separate, scoped, expiring credentials.

This is the operating model behind
[isolated-agent security](../security/isolated/README.md): that page protects one
checkout, this one describes how the whole thing runs.

## What Bounds a Run

The orchestrator stays available. The subagents do not run without limit.
Leaving many agents to work overnight and hand work to each other in prose
is a different pattern, and
[Engineering with Agents](engineering/README.md) sets out what it costs. Four
limits keep this model apart from it.

- **A subagent starts from a specification.** It receives the scenarios to
  satisfy, the files it may touch and what done looks like. It does not
  receive another agent's notes. See
  [Goals and Specifications](engineering/goals-and-specs.md).
- **A subagent's session is short.** One unit of work, then it ends. Work too
  large for one short session is split in the plan first.
- **A machine proves the result.** Lint, tests and gates decide whether the
  work is accepted. The subagent's own report is a claim. See
  [Mechanical Checks](engineering/mechanical-checks.md).
- **The result is one reviewable change.** The orchestrator collects the
  subagents' branches into one pull request or a short stack. Who approves
  it follows the risk, as
  [Agent Code Review](engineering/code-review/README.md) sets out. Agent-to-agent text is
  never committed. See
  [Sessions and Subagents](engineering/sessions-and-subagents.md).

## The Two Planes

|                      | Orchestrator                                                               | Subagent                                                           |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Runs                 | stays available, on a dedicated machine and OS account                     | on demand, one short session per unit of work                      |
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

## Why Split the Planes

This is the non-obvious part, and the reason the pattern earns its setup. There
are two reasons, and they are independent: one is about what each side _can do_,
the other about what each side is _trusted with_.

### Capability

The orchestrator runs on the interactive Claude.ai subscription because that is
where the capabilities the planning work needs currently live, and they are not
on the Bedrock path:

- **The stronger model for hard work.** Complicated orchestration can run on
  Fable; the subscription exposes it, the Bedrock path does not.
- **Remote control.** Driving and steering a session from elsewhere (a phone, for
  example) is a subscription feature.
- **Auto mode.** Running unattended is available on the subscription session.

At the time of writing, remote control and auto mode are open feature requests
for the Bedrock path, not shipped, and the newest models reach Bedrock on a lag.
So this reason is **time-dependent**: if Bedrock reaches parity it weakens. The
next reason does not.

### Security and Cost

Orchestration and code execution have different risk, cost, and scope profiles,
so they get different credentials:

- **Orchestration** is interactive, low volume, and needs broad read plus MCP. It
  is the part you talk to.
- **Code execution** is the higher-risk, higher-volume part. It runs on Bedrock
  with credentials that are scoped by IAM, expire on their own, and are tagged
  for per-team cost allocation.

So the credential that can run code is never the credential you use to think and
plan, and it expires without anyone remembering to revoke it. That is least
privilege and cheap revocation, applied to the agent's own identity rather than
to a human's. Unlike the capability reason, this one is **structural**: it holds
even if Bedrock ships every feature above.

## One OS Account Per Client

The orchestrator runs under a dedicated operating-system account, one per client,
on a persistent machine you can reach remotely (see
[observability](observability/README.md) for remote control). The account has
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
fails, the orchestrator steers it back rather than letting it run open loop. A
subagent that cannot meet its specification stops and reports the blocker. It
does not keep trying through the night. Two practices pair with this:

- **Goal plan and execute** ([goal](../plugins/planner/skills/goal/SKILL.md) /
  [execute](../plugins/planner/skills/execute/SKILL.md)): the plan is the contract.
  One identity executes the work, a separate identity verifies the plan was met.
  The orchestrator is where that separation is enforced.
- **[Observability](observability/README.md)**: how you see the state and get
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
per-client accounts, or cloud SSO. Reach for it when agents work away from your
own machine, across more than one client, and the cost of a mistake reaching
the wrong context is real.

It is also the wrong tool for work that has no specification yet. Explore
that first, as [Prototypes](engineering/prototypes.md) describes, because a
subagent given a vague task spends tokens producing something nobody asked
for.
