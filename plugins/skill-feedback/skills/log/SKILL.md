---
name: log
description: Append one outcome entry for a skill run to the skill outcome log, as the last step of that skill or by hand afterwards. Records the skill and version, whether the run was ok, corrected or failed, the failure mode, the cause, how the problem was found and where the fix went. Use when a skill's last step says to log the outcome, or when the user says "/skill-feedback:log", "log that run", "log the outcome", or reports later that a skill's output was wrong.
user-invocable: true
---

# Log a Skill Outcome

Write one entry for one skill run. The entry is the input to
[review](../review/SKILL.md), which decides what to change in the skill.

The CLI is `bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts"`. In a clone of
the toolkit it is `bun plugins/skill-feedback/scripts/outcome-log.ts`.

## Step 1: Settle the Fields

The calling skill normally gives every field. Ask the operator only for what
is missing and cannot be read from the run.

| Field      | Value                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `skill`    | Pass `--skill-dir <the skill's directory>` and the script reads the name and version.           |
| `outcome`  | `ok`, `corrected` (the operator fixed the output) or `failed` (the run stopped or was unusable) |
| `mode`     | A short slug for the way it went wrong, such as `creates-duplicate`. Empty when `ok`.           |
| `what`     | One sentence on what went wrong. Empty when `ok`.                                               |
| `cause`    | The best guess at why, ending in `(confirmed)` or `(guess)`.                                    |
| `detected` | `check` (a script or hook caught it), `review` (the operator saw it) or `later-use`             |
| `fix`      | `skill-instructions`, `skill-script`, `config`, `shared-store`, `check` or `none`               |
| `cost`     | Time or tokens, when the number is known. Leave it out otherwise.                               |

Log a run that went well too. Without the `ok` entries, the review cannot
tell a skill that fails one run in fifty from one that fails every second
run.

Describe the failure and leave out the data. `what` and `cause` never hold a
person's name, an address, a subject line, an amount or a ticket key. Write
"Proposed deleting a message from a known correspondent", and do not name the
correspondent.

## Step 2: Reuse the Mode

For a `corrected` or `failed` run, list the modes already logged for the
skill:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts" modes --skill <name>
```

Use an existing slug when it describes the same way of going wrong. The
review counts entries per slug, so two slugs for one failure halve its count.
Make a new slug only for a new way of going wrong. Name the wrong result, not
the cause: `deletes-wanted-message`, not `rule-missing`.

## Step 3: Append

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts" append \
  --skill-dir "<skill directory>" --outcome corrected \
  --mode creates-duplicate \
  --what "Created a second expense for a receipt already imported" \
  --cause "Duplicate check compares amount only (confirmed)" \
  --detected review --fix skill-script --cost "6 min"
```

The script validates the entry and appends it to the local log. An invalid
entry is refused with one line per problem and nothing is written. Fix the
field and run it again. Do not write to the log file by any other route.

The output names the entry's `id` and, when a shared copy is configured, the
`outboxFile` that holds the document to push.

## Step 4: Push to the Shared Copy

Skip this step when the output shows `"artifact": null`, when the session has
no `ArtifactData` tool, or when the run is unattended. The entry is already
in the local log, and a later attended run pushes it.

Otherwise list what is waiting, which can include entries from earlier runs:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts" pending
```

Send the `writes` array as it is, in one `ArtifactData` call with
`action: "batch"` and the `artifact` address as `url`. Send at most 50 writes
per call. Then remove the pushed entries from the outbox:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts" sent <id>...
```

Two refusals are expected, and neither is a failed run:

- `version_mismatch` on a document means that entry is already in the shared
  copy. Run `sent` for that id and push the rest again.
- "no such artifact, collection, or document (or no access)" means this
  session is signed in to an account that cannot open the artifact. Leave the
  outbox as it is and say so in the report.

## Step 5: Report

One line: `logged: <skill> <outcome>[ <mode>], shared copy: pushed <n>` or
`shared copy: <n> waiting`, with the reason when entries are waiting.

## Failure Modes

- Bun is not installed, or the script cannot write its directory: report the
  error. Do not fall back to writing the entry somewhere else.
- The calling skill gave an outcome but no mode for a failure: ask the
  operator for one sentence on what went wrong and propose the slug.
- The operator reports a failure days later: log a new entry with
  `--detected later-use` and `--date` set to the day of the run. The earlier
  `ok` entry stays, because the log is append-only.
