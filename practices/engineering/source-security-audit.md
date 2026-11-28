# Source Security Audit

[ai-toolkit](../../README.md) / [Practices](../README.md) / [Engineering with Agents](README.md)

A source security audit has agents read one repository at one commit and
report where a trust boundary fails. Run it on the commit a release was cut
from, keep its records with the release, and let a confirmed finding block
the shipment to production.

The audit is the `review` skill in
[Source Audit](../../plugins/source-audit/README.md). This page says where
that skill runs in the workflow from
[Merge, Release and Ship](merge-release-ship.md) and what a gate does with
its records. The skill exists and has been run in isolation on a sample. No
pipeline runs it yet.

## Workflow

![Audit workflow](source-audit-workflow.svg)

<details>
<summary>The steps in detail</summary>

1. **Release commit.** The release names one commit. The audit reads the
   repository at that commit and nothing else.
2. **Restore earlier runs.** The job copies the records of earlier runs for
   this repository from a private store. The audit reads their findings, so
   a weakness keeps its name and an open lead is not forgotten.
3. **Audit in isolation.** Two agents hunt for failures in different ways,
   and fresh agents try to disprove each candidate. They run in a container that holds no
   credential worth taking.
4. **Validate and gate.** A script checks that the records are complete,
   agree with each other and name the release commit. The gate then blocks
   on a confirmed finding at the chosen severity.
5. **Store the evidence.** The whole run folder goes to the private store.
   The release manifest records the run, the verdict and a digest.
6. **Triage the leads.** A person takes each lead the audit could not settle
   from source, and records the answer.

The dashed arrow shows that the records stored in step 5 are input to step 2
of the next run.

</details>

## The Practice

### Know What the Audit Covers

The skill reads source. It lists who can call what, follows what they send
to the place where it has an effect, and reports each path as a record with
a file and a line.

| It covers                                                                     | It does not cover                                          |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| One repository at one commit, or named paths, or a diff                       | A deployed system, in any environment                      |
| Injection, access control, files and requests, secrets, logic, feature misuse | Settings that live outside the repository, such as a proxy |
| A second agent's attempt to disprove each finding                             | A lookup of known weaknesses in dependencies               |
| Findings that keep their name from one run to the next                        | Proof that nothing is wrong                                |

It is not the penetration test in step 5 of the delivery workflow. It never
contacts a deployed system.

Every record has one of three verdicts.

| Verdict            | Meaning                                                      | Severity | Who acts                |
| ------------------ | ------------------------------------------------------------ | -------- | ----------------------- |
| `confirmed`        | The path is complete in the source and a second agent agreed | Yes      | The gate, then the team |
| `needs_validation` | The path is real, and one fact outside the source decides it | No       | A named person          |
| `rejected`         | The second agent disproved the candidate                     | No       | Nobody                  |

A clean result is weak evidence. One pass over a codebase does not find
everything, and the report says so. In one comparison on a codebase of about
20,000 lines, two different audits of the same code reported seven findings and
leads between them, and almost none in common. The skill therefore hunts twice, in
two different ways, and a run between releases adds a third reading.

### Run It on the Release Commit

The audit needs the source and nothing else. It needs no built part and no
running environment, so it can start as soon as the release names a commit.

- **Start it from the release.** The audit runs beside the shipment to
  staging and the qualification tests. It does not wait for them, and they
  do not wait for it.
- **Check it at the production gate.** Production accepts a release only
  with its evidence attached. The audit's verdict for that exact commit is
  one more piece of that evidence.
- **Check it before the publish, for a library.** A package on a public
  registry reaches its users at once, so the publish is the shipment. The
  audit's verdict is checked before it.
- **Keep the penetration test.** Step 5 still needs a tool that attacks the
  deployed system. The source audit reads the inside of the code, and the
  penetration test tries the outside of the running system. Each finds what
  the other cannot reach.
- **Run it between releases as well.** A nightly run on the main branch
  finds a weakness sooner, and the run at release then starts from its
  records.

The audit does not belong in the merge gate. Two runs on the same commit can
report different things, and a merge check must give the same answer to
everyone, every time. See [Mechanical Checks](mechanical-checks.md).

### Run It in Isolation

The repository under audit is input to the agents. A file in it, or in a
dependency, can hold text written to mislead them. Run the audit where a
misled agent can reach nothing of value.

- **One credential.** The job holds the key for the model and no other
  secret. It has no deployment key and no token that can write to a
  repository.
- **A copy of the source that cannot be changed.** The audit describes
  fixes. It never edits the target.
- **Output outside the target.** The skill writes its run folder outside the
  repository, so the records cannot be committed by accident.
- **A network limited to the model.** The job can reach the model's
  service and nothing else.

See [Isolated Container](../isolated-container/README.md).

The skill's default is to read and not to run the target's code. Do not rely
on that default. It is an instruction, and an agent can fail to follow one.
The skill this one draws on had a stricter rule, and in its one measured run
twelve of sixteen agents ran the target's code with no sandbox while the
report said the run was sandboxed. So treat the audit job as a job that may
run untrusted code. The container is the control.

A run that does run the target must say so in its records. That statement is
a claim made by an agent, and the gate does not read it as evidence of
isolation.

### Keep the Evidence With the Release

A run writes one folder.

| File            | What it holds                                                          |
| --------------- | ---------------------------------------------------------------------- |
| `run.json`      | The commit, the scope, what was read, what was left out, and the state |
| `findings.json` | Every record, under one of the three verdicts                          |
| `REPORT.md`     | The same content for a reader                                          |

Store the whole folder in a private place, under the repository's name and
the run's number. The release manifest then records four things.

1. The number of the run.
2. The commit the run read.
3. The verdict of the gate.
4. A digest of the stored folder, so a later reader can show it is unchanged.

Do not attach the folder to a public release. A confirmed finding holds the
steps to reproduce a weakness that may not be fixed yet.

### Carry the Findings Between Runs

The skill reads the findings of earlier runs before it hunts. A runner in
continuous integration (CI) starts empty, so the job moves the folders
itself.

1. Before the run, copy the earlier run folders for this repository from the
   store.
2. Let the skill write the next numbered folder.
3. After the gate, copy the new folder to the store.
4. Never change a stored folder. Each run is a record of its own commit.

Run one audit at a time for each repository. A nightly run and a release
run that overlap would both copy the same earlier folders and take the same
next number. Put the audit jobs for one repository in a queue, so the second
starts after the first has stored its folder. The store also refuses a
folder whose number it already holds, and the job fails when that happens.
It never overwrites or merges.

| Earlier record                         | In the new run                               |
| -------------------------------------- | -------------------------------------------- |
| `confirmed`, and the code is unchanged | Checked again, under the same fingerprint    |
| `needs_validation`                     | A candidate again, and it keeps its question |
| `rejected`, and the code is unchanged  | Not raised again                             |
| Any record whose code changed          | The code is read as new                      |

These are the skill's written rules. They have not been observed over two
runs.

### Gate on the Records

The gate has two parts. The first is the skill's validator, and the second
is the release policy.

The validator fails when the records cannot be relied on.

| Check                                                                    | Why it fails                              |
| ------------------------------------------------------------------------ | ----------------------------------------- |
| `run.json` or `findings.json` is missing, is a link or is not valid JSON | There is nothing to judge                 |
| The run names no files that were read                                    | An empty run would pass as a clean result |
| The commit in the record is not the one the job names                    | The evidence is for a different version   |
| A candidate has no record, and the run says it finished                  | A lead was dropped before it was judged   |
| A record was checked by the agent that found it                          | Nobody tried to disprove it               |
| A lead carries a severity, or a finding lacks one                        | The verdicts would be mixed up            |

The job checks out the release commit itself, gives the audit that checkout
and passes the same commit to the validator. The validator compares it with
the commit in the record. It cannot show which files an agent read, so the
checkout the job supplies is what ties the audit to the release.

The policy then blocks a release when either of these is true.

- The run's state is not `complete`.
- A `confirmed` finding is at or above the chosen severity.

Choose the severity once, in policy. A reasonable start is to block on
`high` and `critical`, and to open a ticket for anything lower.

The policy reads `findings.json` itself. It takes each confirmed finding at
or above the chosen severity and looks for its fingerprint among the
exemptions. The validator's summary line, with the count under each verdict
and the highest confirmed severity, is for the report and the manifest. Two
runs can share those numbers and differ in which findings they hold.

The rest goes to a person and does not block.

- **Every `needs_validation` record.** It has no severity by design. It
  names the fact that would settle it, such as a proxy rule, and who can
  observe that fact. A named person observes it and records the answer.
- **Gaps.** The run lists what was in scope and not read. The manifest
  states how many, so a partial audit is visible as partial.
- **Confirmed findings below the chosen severity.** These become ordinary
  work with a due date.

An exemption is the only way past a blocking finding. It is a named entry in
one file, with the finding's fingerprint, a reason, a person and an end
date, and it is reviewed like code. The same file holds the answers to
leads, because a lead returns on every run until someone answers it.

A pass means that no known blocker is open. It does not mean the release is
secure.

Each failure follows the rule in [Mechanical Checks](mechanical-checks.md).
The validator's failures name the place, the change, the rule and its page.
A failure of the policy names the finding, the file and line where its path
ends, and the fix the audit proposes.

### Know What It Costs

The skill was measured once, on a sample of about 450 lines with nine
planted weaknesses, against a plain request to the same model.

| Measure                           | The skill            | A plain request     |
| --------------------------------- | -------------------- | ------------------- |
| Planted weaknesses                | 9 of 9 confirmed     | 9 of 9 reported     |
| Checked by a second agent         | Every record         | None                |
| Wall time                         | 7 minutes 32 seconds | 1 minute 31 seconds |
| Cost reported by the tool, in USD | 2.67                 | 0.58                |

On a sample this small the skill found what the plain request found, at
about five times the cost. What it adds is the second agent's check, the
lead it left for a person, and records a gate can read. It has not been run
on a large codebase.

Give the audit job a time limit and a spending limit of its own, and record
what each run used. The expected cost of a release then comes from measured
runs.

## Why

Security tests against a running system see it as an outsider does. They
cannot see a missing check on a path nobody thought to try. A source audit
starts from the code, so it finds the missing check and points at the line.
The two together cover more than either alone.

The argument for running it on every release is the one for penetration
tests. A yearly review describes a system that has since shipped dozens of
times. An audit on the release commit finds a weakness in the version that
introduced it.

The verdicts suit a gate because they separate what is known from what is
suspected. A confirmed finding was traced by one agent and checked by a
second whose task was to disprove it. That is strong enough to block on. A
lead with an open question is a job for a person, and giving it a severity
would only hide that.

The records are still claims made by agents. The validator proves that they
are complete and consistent, and no script proves that a file listed as read
was read with care. So the gate blocks on what the audit found, and nobody
reads a clean result as proof.

The skill is small on purpose. A larger skill by another publisher was read
and run first, with reconnaissance agents, a coverage ledger and critics. On
a sample it found what a plain request to the same model found, at about 24
times the cost. What it added was the second agent and the fixed records, so
those are what this skill keeps. The plugin's page has the numbers.

## The Failure It Prevents

- A security review once a year, whose report describes an old version.
- Findings that live in a chat or a document, where they cannot be tracked
  from one release to the next.
- A finding that one agent reported and nobody tried to disprove.
- An audit agent that holds deployment credentials while it reads untrusted
  text.
- Reproduction steps for an open weakness, published with the release notes.
- A release that ships because the audit job failed quietly and left empty
  files.

## How It Is Enforced

The skill and its validator exist. The pipeline around them does not, so
these are the controls when it is built.

- The validator has tests of its own, with a failing case and a passing case
  for each rule, and a test that every failure links to a section that
  exists.
- The audit job runs in a container with one credential and a network
  limited to the model, and its workflow has no permission to write to a
  repository or to deploy.
- The policy that blocks on severity is tested like the validator.
- Production accepts a release only when the manifest holds a passing audit
  verdict for that exact commit.
- The evidence store is private, and stored runs are never changed.

This repository publishes packages to a public registry, and for those the
publish is the shipment. An audit of the release commit would therefore have
to pass before the publish. Nothing has been decided about running one here.
