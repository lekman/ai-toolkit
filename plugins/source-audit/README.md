# Source Audit

[ai-toolkit](../../README.md) / [Plugins](../README.md)

Review a repository's source for security weaknesses, with a second agent that
tries to disprove each finding, and leave records that a script validates and
a release gate can read.

The practice behind it is
[Source Security Audit](../../practices/engineering/source-security-audit.md).

## Install

```text
/plugin marketplace add lekman/ai-toolkit
/plugin install source-audit@ai-toolkit
```

Needs Node 20 or later for the validator. It has no dependencies.

## Skill

- **[review](skills/review/SKILL.md)** (`/source-audit:review`): reads one
  repository at one commit and hunts twice for places where a trust boundary
  fails, once by entry point and once with a plain request to a fresh agent.
  It gives every candidate to another fresh agent that tries to disprove it,
  and writes the records and a report to a run folder outside the repository.

Claude Code has a built-in `/security-review` command, which looks at the
pending changes on a branch and answers in the conversation. This skill is
for a review that must leave evidence: a whole repository, named paths or a
diff, at a recorded commit, with each finding checked twice.

## What a Run Writes

| File            | What it holds                                                          |
| --------------- | ---------------------------------------------------------------------- |
| `run.json`      | The commit, the scope, what was read, what was left out, and the state |
| `findings.json` | Every record, under one of three verdicts                              |
| `REPORT.md`     | The same content for a reader                                          |

| Verdict            | Meaning                                                      | Severity |
| ------------------ | ------------------------------------------------------------ | -------- |
| `confirmed`        | The path is complete in the source and a second agent agreed | Yes      |
| `needs_validation` | The path is real, and one fact outside the source decides it | No       |
| `rejected`         | The second agent disproved it                                | No       |

The formats are in [Record Formats](skills/review/records.md).

A run folder holds the steps to reproduce open weaknesses. Keep it private,
and never attach it to a public release.

## Validate a Run

```bash
node plugins/source-audit/scripts/validate.mjs <run folder> --commit <full commit>
```

Exit status 0 means the records are well formed and agree with each other.
It prints one summary line, or with `--json` the same as JSON.

```text
PASS: 8 confirmed, 0 needs_validation, 0 rejected, 2 gap(s), highest confirmed severity critical, run complete
```

The validator does not judge severity. A gate that blocks a release reads the
summary and applies its own policy, such as blocking on `high` and above.

## Measured on a Sample

The skill was run once, in an isolated container, on a sample service of
about 450 lines with nine planted weaknesses and two decoys. The model was
`claude-sonnet-5`. The same model was also asked plainly to find the
vulnerabilities, with no skill.

| Measure                           | This skill           | A plain request     |
| --------------------------------- | -------------------- | ------------------- |
| Planted weaknesses                | 9 of 9 confirmed     | 9 of 9 reported     |
| Decoys reported                   | 0 of 2               | 0 of 2              |
| Checked by a second agent         | Every record         | None                |
| Leads for a person                | 1                    | None                |
| Agents started                    | 3                    | None                |
| Ran the target's code             | No                   | No                  |
| Wall time                         | 7 minutes 32 seconds | 1 minute 31 seconds |
| Output tokens                     | 63,767               | 8,882               |
| Cost reported by the tool, in USD | 2.67                 | 0.58                |

The three agents were the second hunting pass and two verifiers. The lead
was a sign-in with no limit on attempts, which depends on what sits in front
of the service. The records failed validation once, on a field that did not
belong to a lead. The agent repaired them from the failure message, and they
then passed.

This is one run on a small sample, so read it as a first measurement. The
skill has not been run on a large codebase. Severity also varies between
runs. An earlier run of the skill, before the second pass was added, rated
one of the same findings a level higher.

## Record Rules

Each failure the validator prints names one of these rules.

### The Run Folder Holds Two Files

Write `run.json` and `findings.json` into the run folder as ordinary files of
valid JSON, each under 5 MiB.

A link is refused, so a run folder cannot point the validator at a file
somewhere else.

### The Run Record Is Complete

Give `run.json` the full commit, the scope, the state, every file that was
read, the gaps and the hardening notes. The formats page lists each field.

A short commit is refused, because a gate compares the commit with the one it
checked out. An empty list of files read is refused, so a run that did nothing
cannot pass as a clean result.

### Every Record Has the Common Fields

Give each record a verdict, a fingerprint, a title, a description, a root
cause, a trace, the pass that found it and the name of the agent that checked
it. `found_by` is `first-pass`, `second-pass` or `both`.

The fingerprint names the root cause in the code, so the same weakness keeps
its name from one run to the next.

### Each Verdict Has Its Own Fields

Add the fields of the record's verdict, and remove any that belong to another.
A `confirmed` record has an attacker, a boundary, a result, a severity with
its reason, a method, evidence and a fix. A `needs_validation` record has a
blocker and a plan. A `rejected` record has a reason.

A lead with a severity looks like a finding, and a person then ranks it
beside ones that were confirmed. Only confirmed records carry one.

### The Trace Points at Real Places

Write each step of the trace as a file relative to the repository, a line
number of 1 or more, and a note. Start at the entry point and end at the sink.

A path that leaves the repository is refused. The validator does not open the
files, so it cannot tell that a line holds what the note says.

### A Second Agent Checks Every Record

Have an agent that did not hunt check the candidate, and put that agent's
name in `verified_by`. The name of a hunting pass is refused there.

The second agent is what the vetting run showed to be worth its cost. Its
task is to disprove the candidate, and a finding that survives is one a gate
can block on.

### Records Are Sorted and Unique

Sort the records by fingerprint, and merge two records that share one.

Two runs can then be compared line by line.

### No Candidate Is Dropped

List every candidate in `run.json` before verification, and give each one a
record. If the run stops before that, set its state to `incomplete`.

A candidate that is neither confirmed nor rejected and simply vanishes is the
failure this catches.

### Running the Target Is Declared

When any agent ran the target's code, set `ran_target_code` to `true` and say
in `isolation` what kept that code away from anything of value. A record
checked that way has `method` set to `local` and lists its steps.

In the vetting run of the skill this one draws on, agents ran the target with
no sandbox and the report said the run was sandboxed. Here the default is not
to run it, and a run that does must say so. This is a claim by the agent. The
control is the container the review runs in.

### The Commit Is the One Asked For

Pass `--commit` with the commit the job checked out, and review that commit.

The evidence for a release is only evidence for that release's commit.

## Provenance

This skill takes ideas, and the shape of its records, from
[cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill)
at commit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`, dated 14 Sep 2026. That
skill was read in full and run once in an isolated container on 28 Nov 2026,
on a sample of about 450 lines with nine planted weaknesses and two decoys.

| Measure                           | That skill            | A plain request     |
| --------------------------------- | --------------------- | ------------------- |
| Planted weaknesses found          | 8 of 8 that qualify   | 9 of 9              |
| Decoys reported                   | 0 of 2                | 0 of 2              |
| Wall time                         | 28 minutes 14 seconds | 1 minute 31 seconds |
| Cost reported by the tool, in USD | 14.15                 | 0.58                |

Both used the model `claude-sonnet-5`. The plain request was the same model
asked to find the vulnerabilities, with no skill.

On the sample that skill found nothing the plain request missed, at about
24 times the cost. Twelve of its sixteen agents also ran the target's code
with no sandbox, against its own rule, and its report said the run was
sandboxed.

A second pair of runs used a real codebase of about 20,000 lines, in the
same container with the same model.

| Measure                           | That skill            | A plain request      |
| --------------------------------- | --------------------- | -------------------- |
| Findings                          | 1 confirmed, 2 leads  | 4                    |
| Found by both                     | Almost none           | Almost none          |
| Wall time                         | 37 minutes 39 seconds | 5 minutes 36 seconds |
| Cost reported by the tool, in USD | 24.30                 | 2.75                 |

The skill's confirmed finding was real, and the plain request had missed it.
The plain request found three weaknesses the skill had missed. Neither run
covered what the two covered together. That run of the skill ran no target
code.

So that skill was not adopted and not forked. What the runs showed to be
worth having is kept here, and the rest is left out. The second pair of runs
is also why this skill hunts twice.

| Taken                                                              | Left out                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| A fresh agent that tries to disprove each candidate                | Four reconnaissance agents before any hunting           |
| Build and release workflows as a class to hunt in                  | A hunter agent for every unit of a ledger               |
| Three verdicts, with severity on confirmed records only            | A coverage ledger with its own validator                |
| A candidate needs an attacker, a control and a result              | Critic agents, run profiles and a budget of agent calls |
| Records with a trace of file and line, and a stable fingerprint    | Ten pages of attack classes for special domains         |
| A validator with no dependencies, and safe printing of record text | A sandbox rule the agents did not keep                  |
| Rejected records kept, so a claim is not raised twice              | Eleven steps for copying files out of a sandbox         |

The validator is written for this repository. No file is copied from that
project. Its record shape and several of its checks follow that project's
schema and validator, which are under the MIT licence.

<details>
<summary>The licence notice of the project this draws on</summary>

```text
MIT License

Copyright (c) 2025-2026 Cloudflare, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>
