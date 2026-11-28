---
name: review
description: Run a failure mode and effects analysis (FMEA) over the skill outcome log. Groups logged failures by skill and failure mode, scores severity, occurrence and detection from 1 to 10, ranks the modes by risk priority number, and proposes one change per mode without applying any. Use monthly, when a skill has around twenty entries, or when the user says "/skill-feedback:review", "review the skill log", "which skill should I fix first", or "run the FMEA".
user-invocable: true
---

# Review the Skill Outcome Log

Rank the ways the skills fail and propose what to change. This skill proposes
and never edits a skill, a script, a rules file or a hook. The operator
decides, and the change is made as its own piece of work.

The CLI is `bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts"`. In a clone of
the toolkit it is `bun plugins/skill-feedback/scripts/outcome-log.ts`. The
script does the grouping, the scoring and the arithmetic. Do not recount or
recompute its numbers by hand.

## Step 1: Collect the Entries

Run `config` to see whether a shared copy is configured.

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts" config
```

With no `artifact`, or with no `ArtifactData` tool in the session, the review
covers this machine's log only. Say so in the report and go to Step 2.

With a shared copy the session can reach:

1. Export it. Call `ArtifactData` with `action: "list"`, `collection: "runs"`,
   `query: {limit: 1000}` and `out_dir` set to a new temporary directory.
   Follow `next_cursor` until there is none. Do the same for the `reviews`
   collection into the same directory.
2. Push what this machine still holds. Run `pending --export <dir>`, send the
   `writes` as one `ArtifactData` batch of at most 50, then run `sent` with
   the pushed ids, as in the [log](../log/SKILL.md) skill.

Pass `--export <dir>` to every command below. The script merges the export
with the local log and counts each entry once.

## Step 2: Check the Modes

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts" modes --export <dir>
```

Two slugs that name the same way of going wrong split one count in two. Point
out each such pair to the operator and say which slug future entries should
use. Do not rewrite logged entries.

## Step 3: Score Severity

Run the review once to see which modes have no severity:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts" review --export <dir>
```

Severity is the one score that needs judgement. For each unscored mode,
propose a score with one sentence of reasoning, on this scale:

| Score | The effect when it happens                                                  |
| ----- | --------------------------------------------------------------------------- |
| 1–2   | Cosmetic. Nothing needs redoing.                                            |
| 3–4   | A few minutes of correction. Nothing is lost.                               |
| 5–6   | A wrong result reached a record the operator owns, and it can be put right. |
| 7–8   | A wrong result reached someone else, or costs money or hours to undo.       |
| 9–10  | Something is lost for good, or there is a security, privacy or legal effect |

Ask the operator to accept or change each score with AskUserQuestion, then
store it:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts" severity <skill> <mode> <1-10> --note "<reason>"
```

Severity belongs to the mode, so it stays the same between reviews unless the
operator changes it. Occurrence and detection come from the log:

- **Occurrence** is the mode's share of the skill's runs in the window, on a
  fixed scale: up to 0.5% scores 1, 1% 2, 2% 3, 5% 4, 10% 5, 20% 6, 33% 7,
  50% 8, 75% 9, and more scores 10.
- **Detection** is the mean of how each failure was found: `check` scores 2,
  `review` 5 and `later-use` 8.

## Step 4: Rank

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/outcome-log.ts" review --export <dir> \
  --out ~/.config/skill-feedback/reviews/<today>.json
```

Show the tables as printed. The risk priority number is severity times
occurrence times detection. Read the flags before drawing conclusions:

- **severity 9 or 10**: look at this mode whatever its total.
- **fewer than 20 runs**: the occurrence score rests on a small sample. Say
  so, and prefer waiting for more entries over a large change.

To score a skill again after a change, add `--skill <name> --from <date>`
with the date the change went in, so only runs since then count.

## Step 5: Propose

Work down from the highest number, and include every mode flagged for
severity. For each, propose one change and say where it goes:

| The change is about                            | It goes in                             |
| ---------------------------------------------- | -------------------------------------- |
| The method, true for anyone who uses the skill | The skill's instructions               |
| A step that must be exact every time           | A script inside the skill              |
| The operator's own preferences or data         | A configuration file outside the skill |
| A rule the agent keeps breaking                | A check, such as a hook                |

- The `Lever` column says which score is larger. For `occurrence`, propose a
  script for the exact step or a clearer instruction. For `detection`,
  propose a check that catches the failure.
- If neither is possible, propose a confirmation step, or retiring the skill.
- A mode that is rare, mild and always caught needs no action. Say so with
  the three scores as the reason.

Present the proposals as a Decide table and ask each with AskUserQuestion.
Apply nothing in this skill, including after a yes. A yes records the
decision. The change itself is separate work, in the repository or the
configuration that owns the skill.

## Step 6: Record

Add a `decision` field to each mode in the `--out` file: the operator's
choice in one sentence, or `no action` with the reason. With a shared copy in
reach, store the file with `ArtifactData`: `action: "set"`,
`collection: "reviews"`, `doc_id` set to the review date and `file_path` set
to the file. A second review on the same date needs the stored document's
`version` as `if_version`.

Report one line: `review: <n> runs, <m> modes ranked, top <skill>/<mode> RPN
<n>, <k> changes proposed, <j> accepted`.

## Failure Modes

- The log is empty or holds only `ok` entries: report the run counts and
  stop. There is nothing to rank.
- The script reports unreadable lines: tell the operator how many and which
  file. Do not repair the file without asking.
- The export fails with "no such artifact … (or no access)": this session's
  account cannot open the artifact. Review the local log and say that other
  machines' entries are missing.
