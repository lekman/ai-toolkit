---
name: review
description: Review a repository's source for security weaknesses and leave records a gate can read. One agent reads the code for places where a trust boundary fails, a fresh agent tries to disprove each candidate, and the run writes findings under three verdicts (confirmed, needs_validation, rejected) that a script validates. Use when the user says "/source-audit:review", "audit this repository for security", "security review with verification", or asks for a security review of a release commit, of named paths or of a diff. For a quick look at the pending changes on a branch, the built-in /security-review is enough.
user-invocable: true
---

# Review Source for Security Weaknesses

Read one repository at one commit, find where a trust boundary fails, have a
second agent try to disprove each finding, and write the result as records.

The validator is `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs"`. In a clone
of the toolkit it is `node plugins/source-audit/scripts/validate.mjs`.

## What to Settle First

- **Target.** The repository root. Default is the working directory.
- **Scope.** The whole repository, named paths, or the diff from a base commit.
- **Run folder.** Where the records go. Use the folder the request names, else
  `~/source-audit/<repository name>/run-<N>` with the next unused number. Never
  write inside the target unless Git ignores that folder. The records hold the
  steps to reproduce open weaknesses, so the folder is private.
- **Earlier runs.** If earlier run folders exist for this repository, read
  their `findings.json` first.

Never change the target. The review describes fixes and applies none.

## Step 1: Record the Commit

Run `git rev-parse HEAD` and `git status --porcelain` in the target. Keep the
full commit. A review is of that commit and of nothing else.

If the status prints anything, the working tree differs from the commit. Do
not read it. Clone the target into a new folder beside the run folder and
check the commit out there.

```bash
git clone --quiet --no-checkout "<target>" "<run folder>/../source-<short commit>" && git -C "<run folder>/../source-<short commit>" checkout --quiet --detach "<full commit>"
```

The clone holds every file of the commit and leaves the target as it was. Do
not use `git archive` for this. It leaves out any file the repository marks
`export-ignore` and rewrites any file marked `export-subst`, so a repository
could hide code from the review.

The **source path** is the folder every agent reads from. It is the clone
when one was made, and the target otherwise. Read from it yourself, and give
it to every agent you start. Never give an agent the target's path when the
working tree differs from the commit.

File paths in the records stay relative to the repository. For a diff scope,
take the changed files from `git diff --name-only <base> HEAD`, which compares
the two commits and ignores the working tree.

## Step 2: Hunt Twice

Two readings of the same code find different things, so the hunt has two
passes. Start the second pass first, then do the first pass yourself while it
runs. Do not start agents to map the system.

### The First Pass, by Entry Point

Read the code yourself.

1. List the entry points: routes, handlers, commands, message consumers, file
   and archive readers, scheduled jobs.
2. For each one, name who can reach it and with what starting access.
3. Follow what they send through parsing and checks to where it has an effect.
4. Compare sibling paths. A check on update and delete that is missing on read
   is the common case.

Work through these classes, and add any the system suggests.

- **Injection.** Input that reaches a query, a shell, a template, a path or a
  URL as text.
- **Access control.** A path to data or an action that skips the owner, tenant
  or role check its siblings make. A field in the request that sets what the
  server should decide.
- **Files and requests.** A path that leaves its folder. A fetch to an address
  the caller chooses. Unsafe unpacking or loading.
- **Secrets and cryptography.** A token that is not signed or not checked. A
  fixed credential. Weak randomness where a value must be secret.
- **Logic.** Steps that can be skipped or replayed. A negative or huge number.
  Two requests that race.
- **Feature misuse.** An export, search, preview or webhook that returns or
  reaches more than the caller may.
- **Build and release.** A workflow that runs code from a pull request while
  it holds a secret or cloud access. An action or dependency taken by a tag
  that can move. A secret handed to a job that does not need it.
- **The plain things.** A secret in the repository or in anything shipped to
  a browser, a debug route, a default account.

A candidate needs three things. It names an attacker and their starting
access, the control that should stop them, and what they get. Without all
three it is a hardening note. A missing best practice, a guess about how the
system is deployed, and harm a user can only do to themselves are not
candidates.

When the scope is too large to read in one pass, split it by part of the
system and give each part to one hunter agent with this pass's text and the
source path. Use at
most four.

### The Second Pass, with Fresh Eyes

Start one agent that gets the source path and the scope, and nothing else.
It gets no list of classes and none of your candidates.

```text
Find the security weaknesses in <scope> of the repository at <source path>. Read the
source, including build and workflow files. Do not run the code and do not
contact any service. Return a JSON list and no other text. Each entry has
title, attacker (who, and with what access), control (what should stop them),
result (what they get), file and line.
```

### Merge the Two

Put the two lists together. Two entries with the same root cause are one
candidate. Record which pass found each one in `found_by`, as `first-pass`,
`second-pass` or `both`.

Give each candidate a fingerprint from the code, such as
`notes-read-no-owner-check`. Use the same fingerprint an earlier run used for
the same root cause.

## Step 3: Write the Candidates Down

Read [records.md](records.md). Write `run.json` in the run folder now, with
every candidate's fingerprint in `candidates`, before any verification. A
candidate that later vanishes with no record fails validation.

## Step 4: Verify

Give every candidate to a fresh agent that did not hunt. One verifier takes up
to five candidates from the same part of the code. Start them together.

Send each verifier the candidates, the source path, the record formats, and
this instruction.

```text
You did not find these candidates. Try to disprove each one from the source.
Do not run the target's code and do not contact any service.

For each candidate:
1. Read every file and line it cites. Correct any that is wrong.
2. Find the strongest check on the path, in this file and in every layer
   around it: router, middleware, framework, database.
3. Decide.
   - rejected: a check stops it, a step it needs cannot happen, or the only
     one harmed is the attacker. Give the reason.
   - needs_validation: the path is real, and one fact outside the repository
     decides it, such as a proxy rule or a cloud setting. Name that fact and
     who can observe it. Give no severity.
   - confirmed: the path is complete in the source and nothing stops it.
     State the attacker, the boundary and the result, and set the severity.
4. Return one JSON record for each candidate, in the given format, with
   verified_by set to your own name. On a confirmed record, set method to
   "source". No other text.
```

Set the severity from what the path shows, never from how alarming the class
sounds.

| Severity        | When                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `critical`      | Someone with no account, or any account, takes over other accounts, runs code or reads the whole store |
| `high`          | A control is fully defeated with real effect, such as reading or changing another user's data          |
| `medium`        | A real crossing with a narrow reach or uncommon conditions                                             |
| `low`           | Internal detail that is not secret is exposed, or much effort buys little                              |
| `informational` | True and minimal, useful mainly as a step in something larger                                          |

Discard a verifier's answer that is not valid JSON and ask a fresh verifier
once. If that also fails, set the run to `incomplete`.

## Step 5: Write and Validate the Records

Write `findings.json`, sorted by fingerprint. Complete `run.json` with every
file that was read, the gaps and the hardening notes. Then run the validator.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" "<run folder>" --commit "<full commit>"
```

Each failure says what to change. Fix the records and run it again until it
passes. Never edit a verdict or a severity to make it pass.

## Step 6: Report

Write `REPORT.md` in the run folder from the records. The report never changes
a verdict.

1. The commit, the scope, and whether the tree was clean.
2. A table of confirmed findings: severity, title, file and line, result.
3. Each confirmed finding: attacker, boundary, result, evidence and fix.
4. Each lead that needs validation: the fact that decides it, and who can
   observe that fact.
5. Hardening notes.
6. Gaps: what was in scope and not read.

Say in the report that a clean result is not proof. One pass does not find
everything.

Then reply with the validator's summary line, the run folder's path, and the
confirmed findings as a short list.

## Earlier Runs

- A `confirmed` record whose code is unchanged goes to a verifier again and
  keeps its fingerprint.
- A `needs_validation` record is a candidate again. It keeps its question
  until someone answers it.
- A `rejected` record whose code is unchanged is not raised again.
- Code that changed since the earlier run is read as new.

## Running the Target's Code

Do not run the target's code. This is the default, and reading is enough to
confirm most findings.

Run it only when the request says the session is isolated, in a container or
a machine that holds nothing of value and no credential beyond the model's.
Then a verifier may start the target with sample data, on the loopback address
only, and stop at the smallest proof. Its record has `method` set to `local`
and lists its `steps`. `run.json` has `ran_target_code` set to `true` and
`isolation` set to what the request said.

Never contact a deployed system, a real account or a shared service. That is a
penetration test, and this skill is not one.

This section is an instruction, and an agent can fail to follow one. The
control is where the session runs. Run an unattended review in a container
whatever this section says.
