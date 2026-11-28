# Skill Feedback

[ai-toolkit](../../README.md) / [Plugins](../README.md)

Log how each skill run went, then use the log to decide which skill to change
first. One skill appends an entry at the end of a run. A second skill runs a
failure mode and effects analysis (FMEA) over the log and proposes changes.
The practice behind it is
[Skill Feedback](../../practices/engineering/skill-feedback.md).

## Install

```text
/plugin marketplace add lekman/ai-toolkit
/plugin install skill-feedback@ai-toolkit
```

Needs [Bun](https://bun.sh).

## Skills

- **[log](skills/log/SKILL.md)** (`/skill-feedback:log`): appends one entry
  for one skill run. A skill calls it as its last step, or you call it by
  hand when you find a problem later.
- **[review](skills/review/SKILL.md)** (`/skill-feedback:review`): groups the
  failures by skill and failure mode, scores them, ranks them by risk
  priority number and proposes one change per mode. It applies nothing.

## The Entry

| Field      | Holds                                                                             |
| ---------- | --------------------------------------------------------------------------------- |
| `date`     | The day the run finished                                                          |
| `skill`    | The skill's name and version, such as `mail:junk@0.3.0`                           |
| `outcome`  | `ok`, `corrected` (you fixed the output) or `failed`                              |
| `mode`     | A slug for the way it went wrong, such as `creates-duplicate`. Empty when `ok`.   |
| `what`     | One sentence on what went wrong. Empty when `ok`.                                 |
| `cause`    | The best guess at why, and whether it is confirmed                                |
| `detected` | `check`, `review` or `later-use`                                                  |
| `fix`      | `skill-instructions`, `skill-script`, `config`, `shared-store`, `check` or `none` |
| `cost`     | Time or tokens, when you have the number                                          |
| `run`      | On a failure found later, the id of the entry that run already has                |

The script adds an `id`, a `loggedAt` timestamp and, when configured, an
`origin` label for the machine.

`run` keeps the counts right when a failure shows up after its run was
logged as `ok`. The log is append-only, so the failure is a second entry. The
review counts both entries as one run that failed.

`mode` is what makes the review exact. Entries with the same slug are one
failure mode, so the script can count them. The log skill lists the slugs a
skill already has before it makes a new one.

Entries describe the failure and leave out the data. No names, addresses,
subject lines, amounts or ticket keys.

## Where the Log Lives

The log has a working store and a shared copy.

- **The working store** is `~/.config/skill-feedback/log.jsonl`, one JSON
  entry per line. Every run can write it, including a scheduled run with
  nobody watching.
- **The shared copy** is a private artifact with a database. A session that
  can reach it pushes the entries it holds, and the review reads both. The
  artifact's page shows the runs per skill, the latest review and the recent
  entries.

The local file comes first because the artifact cannot be reached from every
session. An artifact is private to the account that owns it. A session signed
in to another account is refused, and the refusal reads as "no such
artifact". Those runs still log locally, and their entries are pushed from
the next session that can reach the artifact from that machine.

### What Was Tested

These results come from real calls on 28 November 2026.

| Session                                           | Result                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| Desktop app, signed in as the artifact's owner    | `set`, `get`, `list`, `query` and `batch` all worked               |
| Headless `claude -p` signed in to another account | The tool was present. The write was refused for lack of access.    |
| Cloud session                                     | Not tested. No cloud session could be started from the test setup. |

A write to a document that already exists is refused unless it carries the
document's version. Pushing an entry twice therefore cannot overwrite it.

Stored data is checked when it is read. A log line or a shared document that
is not a complete, valid entry is left out of every count, and the review
says how many were left out.

The database holds at most 25,000 documents per artifact. At ten runs a day
that is over six years of entries.

### Set Up the Shared Copy

1. Publish [store/outcome-log.html](store/outcome-log.html) as a private
   artifact with the `Artifact` tool and these capabilities, which limit
   reading and writing to the owner and editors:

   ```json
   { "db": { "rules": [{ "path": "", "read": "admin", "write": "admin" }] } }
   ```

2. Write the address into `~/.config/skill-feedback/config.json`. `origin` is
   optional and labels the machine in each entry.

   ```json
   { "artifact": "https://claude.ai/artifact/<id>", "origin": "laptop" }
   ```

The address stays in your configuration. Do not commit it.

To use the shared copy from a second account, share the artifact with that
account as Editor from the page's Share menu.

## How the Review Scores

Each failure mode gets three scores from 1 to 10.

- **Severity** is how bad the effect is. You set it once per mode, with the
  scale in the [review](skills/review/SKILL.md) skill, and it is kept in
  `severities.json`.
- **Occurrence** comes from the log. It is the mode's share of the skill's
  runs: up to 0.5% scores 1, 1% scores 2, 2% scores 3, 5% scores 4, 10%
  scores 5, 20% scores 6, 33% scores 7, 50% scores 8, 75% scores 9, and more
  scores 10.
- **Detection** comes from the log. It is the mean of how each failure was
  found: `check` scores 2, `review` scores 5 and `later-use` scores 8. A
  logged failure never scores 9 or 10, because a failure nobody noticed is
  not in the log.

The risk priority number is the three multiplied. The review ranks by it,
flags every mode with a severity of 9 or 10 whatever its total, and marks a
skill with fewer than 20 runs as a small sample.

The occurrence and detection scales are this toolkit's own choices. They are
constants at the top of
[scripts/outcome-log.ts](scripts/outcome-log.ts) and can be changed there.

## Add Logging to a Skill

Add a last step to the skill that names the outcome and calls the log skill.
The [junk mail skill](../mail/skills/junk/SKILL.md) is the worked example.
Its last step maps what happened at the approval gate to an outcome and a
mode, then calls `/skill-feedback:log`. A skill that logs this way keeps
working without this plugin. It skips the step and says so.

## The Script

`scripts/outcome-log.ts` is one Bun script with no dependencies. It validates
and appends entries, queues them for the shared copy, lists the known modes
and the recent entries, stores severities and runs the review. It never talks to the artifact. The
skills do that with the `ArtifactData` tool, using the files the script
prepares.

```bash
bun plugins/skill-feedback/scripts/outcome-log.ts config
```

## Tests

```bash
cd plugins/skill-feedback/scripts && bun test
```
