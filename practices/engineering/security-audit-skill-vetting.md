# Vetting Record for the Security Audit Skill

[ai-toolkit](../../README.md) / [Practices](../README.md) / [Engineering with Agents](README.md)

This is the record of one skill taken through the steps in
[Third-Party Skills](third-party-skills.md). It is for the person who decides
whether the skill is adopted, and it is a worked example of what such a
record holds.

The skill is `security-audit`, published by Cloudflare at
<https://github.com/cloudflare/security-audit-skill>. It was vetted on
28 Nov 2026 by an agent session, at the request of the repository's owner.
[Source Security Audit](source-security-audit.md) describes where the skill
would run.

## Status

| Step             | State on 28 Nov 2026                                               |
| ---------------- | ------------------------------------------------------------------ |
| Queue it         | Done. One commit is recorded below                                 |
| Read it          | Done. All 22 files in the repository were read                     |
| Run in isolation | Partly done. The validator tests ran. The audit itself has not run |
| Evaluate         | Not done. It needs the audit run                                   |
| Decide           | Open. The owner decides, and the options are listed at the end     |

The audit run is blocked on one thing. The container used for isolation has
its own sign-in to the model, and that sign-in had expired. Renewing it is
an act for the owner. The run was not moved to a machine with real
credentials to get round this.

## Queue It

| Fact               | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Repository         | `cloudflare/security-audit-skill`                                  |
| Commit read        | `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`, dated 14 Sep 2026      |
| Tags or releases   | None, so the commit is the only way to name a version              |
| Licence            | MIT. The `LICENSE` file says so, and the GitHub API reported `mit` |
| Repository created | 18 Jun 2026                                                        |
| Files              | 22 in all, and 20 of them in `skills/security-audit/`              |
| Size of the skill  | About 315,000 bytes of text and scripts                            |

The repository had about 79,000 stars on the day. That shows many people
found it. It does not show that anyone read the scripts.

The README installs the skill with `npx skills add` and the repository's
address. That command names no commit. Whether the installer can pin one was
not tested. Until it is, install from a reviewed copy, as the practice says.

## Read It

### What the Folder Holds

| Kind                 | Files | What was found                                                    |
| -------------------- | ----- | ----------------------------------------------------------------- |
| Instructions         | 4     | `SKILL.md` and three pages for the six phases of an audit         |
| Attack class prompts | 11    | One general page and ten for areas such as cloud and browser code |
| Schema               | 1     | The shape of `findings.json`, with one branch for each verdict    |
| Validator scripts    | 2     | One for the findings and one for the coverage ledger              |
| Validator tests      | 2     | 65 tests between them                                             |
| Hooks                | 0     | None                                                              |
| Servers              | 0     | None                                                              |
| Install scripts      | 0     | None, and there is no `package.json`                              |

### What the Practice Asks, Point by Point

| Question                                | Answer                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Steps unrelated to the stated purpose   | None found. No step reads credentials, changes settings or contacts an address             |
| What the scripts load                   | The validators load three Node modules, for files, paths and text decoding                 |
| What the scripts write                  | The validators write nothing. They read one input file and the schema                      |
| What the tests do beyond the validators | They write to the system's temporary folder, start Node again, and call `mkfifo` once each |
| Network calls                           | None in any script                                                                         |
| Downloads                               | None. The instructions forbid installing or fetching dependencies during an audit          |
| Tools the skill needs                   | File reading, a shell, and a way to start subagents. Its header declares none              |
| Hidden text                             | No control, zero-width or direction-changing characters in any of the 22 files             |
| Addresses in the text                   | Three web addresses and one email address, all in the README                               |

The rows on script imports, network calls, hidden text and addresses were
also checked with a search over every file. The rest come from reading.

### What the Instructions Do

The skill has two modes. A question about security gets guidance and writes
nothing. A request to audit a codebase starts the full workflow, which has
six phases.

1. **Reconnaissance.** Four agents map the system and seed the coverage
   ledger.
2. **Hunting.** One agent for each group of ledger units looks for a
   failure. A critic agent then looks for gaps in the ledger.
3. **Validation.** A fresh agent tries to disprove each candidate.
4. **Structured output.** The parent writes `findings.json` and runs both
   validators.
5. **Record verification.** Another fresh agent checks each final record.
6. **Reporting.** The parent writes three reports from the records.

The parent agent is the only writer of the shared files. Each other agent
gets a scratch folder of its own.

### What the Reading Showed About Fit

These points bear on the decision. Each comes from the skill's own text.

- **The safety rules are instructions.** The ban on live endpoints, the
  sandbox and the rule about who writes which file are all prose that an
  agent is asked to follow. Only the two validators are code. An agent that
  ignores a rule is stopped by the container, and by nothing in the skill.
- **The sandbox is required and is not supplied.** The skill runs the
  target's code only inside a sandbox with five controls. It also describes,
  in eleven steps, how trusted code should copy a result out of that
  sandbox. It ships neither the sandbox nor that code.
- **The default output is in the home folder.** A full audit writes to
  `~/security-audit-skill/<repo-name>/run-<N>` unless told otherwise. A
  pipeline should name the folder.
- **A budget is a count of agent calls.** The skill reserves calls for its
  critics and verifiers before it spends any on hunting, and it marks the
  run incomplete when the budget cannot fund them.
- **There are three run profiles.** `quick` runs one round of hunting,
  `standard` repeats until a critic finds no gap, and `deep` adds a second
  pass. A scoped run can audit named paths or the difference between two
  commits.
- **The description is broad.** It lists security questions, reviews and
  "pen tests". Once installed, the skill may load for any of them.

## Run It in Isolation

### The Validator Tests

The skill's own tests were run in a container with no network, a file system
that cannot be written to, a temporary folder in memory, a user without
privileges and the skill folder mounted so it cannot be changed.

| Fact         | Value                              |
| ------------ | ---------------------------------- |
| Node version | 22.23.5                            |
| Tests        | 65                                 |
| Passed       | 65                                 |
| Failed       | 0                                  |
| Skipped      | 0                                  |
| Wall time    | Under 2 seconds, with the start-up |

### What the Validators Accept

Five small files were built to see what a gate could rely on. Every check
below ended with exit status 0.

| Input                                                             | Validator | Result                         |
| ----------------------------------------------------------------- | --------- | ------------------------------ |
| An empty list of findings                                         | Findings  | `PASS: 0 findings valid`       |
| An empty ledger                                                   | Ledger    | `PASS: 0 coverage units valid` |
| A ledger with one unit that was planned and never worked on       | Ledger    | Pass                           |
| A ledger with one unit that was deferred for lack of budget       | Ledger    | Pass                           |
| A ledger that names a candidate, beside an empty list of findings | Both      | Pass                           |
| One confirmed finding of critical severity                        | Findings  | Pass                           |

The validators prove the form of each file. They do not compare the two
files, they do not read `run-metadata.json`, and they do not check that a
file named as evidence exists. The skill's own text says that a pass proves
format only. A gate needs its own checks on top, and
[Source Security Audit](source-security-audit.md) lists them.

### The Audit Run

The audit has not run. This is what is ready for it.

- **A target.** A small notes service in Node, with no dependencies, about
  450 lines. It was written for this test and holds nothing real.
- **A known answer.** Nine weaknesses and two decoys are planted in it. A
  proof script exercises each one against the running service, in a
  container with no network. All eleven behave as planned.
- **A container.** The image from
  [@lekman/claude-docker](../../packages/claude-docker/README.md), with the
  skill mounted at project scope so that nothing is installed for the user,
  the target mounted so it cannot be changed, and no key, vault or
  instruction file from the host.

<details>
<summary>The planted weaknesses and decoys</summary>

| Id  | Weakness                                                                          | Attack class in the skill  |
| --- | --------------------------------------------------------------------------------- | -------------------------- |
| K1  | Note search builds its query from the search text                                 | Injection                  |
| K2  | Reading a note by its number has no owner check                                   | Access control             |
| K3  | The profile update accepts a role, which grants administrator rights              | Access control             |
| K4  | The file download joins a decoded name to a folder with no check                  | Resource and file handling |
| K5  | The export puts a name from the request into a shell command                      | Injection                  |
| K6  | The sign-in token is an unsigned user number, so anyone can forge one             | Cryptography and secrets   |
| K7  | The webhook test fetches any address and returns the answer                       | Feature abuse              |
| K8  | An administrator with a fixed password is created on every start                  | Obvious things             |
| K9  | Passwords are stored as MD5 with no salt                                          | Cryptography and secrets   |
| D1  | Decoy. Administrator routes have no check in the handler, and the router adds one | Access control             |
| D2  | Decoy. A query is built from a string, and the string comes from a fixed list     | Injection                  |

K9 is a weak practice more than a crossed boundary, so the skill's rules
may class it as a hardening note. A report of D1 or D2 as a confirmed
finding would be a false positive.

</details>

The container cannot create a nested sandbox with its default settings, so
the five controls the skill asks for are not available inside it. By the
skill's rules the run should then execute none of the target's code and
record its candidates as `needs_validation`. Whether it does is one of the
things the run will show.

## Evaluate

Not done. When the audit has run, this section will hold four things.

1. The records set against the eleven known items, with each planted
   weakness marked as found, found as a lead or missed.
2. The same task given to an agent without the skill, for comparison.
3. What the run touched, which is every command it ran, every file it wrote
   and every address it called.
4. The tokens used and the wall time, for the run with the skill and the
   run without.

## What Was Verified and What Was Not

| Claim                                                         | Basis                                        |
| ------------------------------------------------------------- | -------------------------------------------- |
| The files contain no hooks, servers, downloads or network use | Read in full, and searched                   |
| The validators only read                                      | Read in full                                 |
| The validator tests pass                                      | Run, in a container with no network          |
| The validators accept empty and unworked records              | Run, with five files built for the purpose   |
| The planted weaknesses are real                               | Run, with a proof script                     |
| The audit forbids live endpoints                              | The skill's text. Not observed in a run      |
| The audit leaves leads when there is no sandbox               | The skill's text. Not observed in a run      |
| Later runs add coverage from the stored ledger                | The skill's text. Not observed over two runs |
| One run finds about half of what repeated runs find           | The authors' statement. Not tested           |
| Fingerprints stay the same from run to run                    | The skill's rule for its agents. Not tested  |
| What an audit costs in tokens and time                        | Not measured                                 |
| How well it finds weaknesses in a large codebase              | Not tested, and the sample will not show it  |

## Decide

The decision is open and belongs to the repository's owner. The table in
[Third-Party Skills](third-party-skills.md) gives four choices. This is what
the evidence so far says about each.

| Choice        | What it would mean here                                                    | Evidence for                                            | Evidence against                                             |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| Adopt         | Keep a reviewed copy at the recorded commit and install from it            | It does only its job, and nothing in it reaches outward | No audit has run, so its output is still unknown             |
| Fork and trim | Copy it and remove the attack class pages that do not apply                | Eleven pages are prompts, and a product needs only some | The skill already selects pages per run, so little is gained |
| Take the idea | Write a smaller skill around the ledger, the verdicts and the second agent | The method is clear and the licence allows it           | The validators and their 65 tests would have to be rebuilt   |
| Reject        | Remove it from the list                                                    | None found. It asks for no more access than it needs    | It fits a gap the delivery workflow has today                |

Whichever is chosen, three things are needed that the skill does not bring.
They are a gate script on top of the validators, a private store for the run
folders, and a sandbox if confirmed findings are wanted from the pipeline.
