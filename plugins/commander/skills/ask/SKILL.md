---
name: ask
description: Ask the owner a question through Atlas without stopping the session, send a message to another agent session on any machine or Claude account, read this session's messages now, or print this session's address. Returns at once; the answer arrives later as a message that a hook shows in this session. Use instead of AskUserQuestion, when the user says "/commander:ask", "ask the owner", "ask Tobias", "message the other session", "tell the reviewer", or when you need a decision and can keep working meanwhile.
user-invocable: true
---

# Ask

`AskUserQuestion` stops a session until the owner opens it. The commander
plugin's hook turns every `AskUserQuestion` call into an Atlas question and
refuses the call, so asking that way works too, with one extra step. This
skill asks directly.

Everything goes through one script:

```bash
ASK="bun <skill-base-dir>/../../scripts/ask.ts"
```

## Ask the Owner

```bash
$ASK ask --question "Which region should the cut-over use?" \
  --header "Region" --option "West=Faster, costs more" --option "North" \
  [--question "Which checks run first?" --option "Smoke" --option "Load" --multi] \
  [--task <task id>]
```

- Up to four `--question` groups. `--option`, `--header` and `--multi` belong
  to the `--question` before them. An option is `label` or
  `label=description`.
- It prints `{"questionId": "q-…", "cardOnly": false}` and returns at once.
  **Do not wait.** Keep working on what does not depend on the answer.
- The task defaults to the task this session claimed last. Pass `--task` to
  name another.
- The answer arrives as a message: at your next prompt, when your turn ends,
  or, when the session is idle, by waking it. It names the question id and
  the answer to each question.
- If nothing can go on without the answer, say so and end your turn. The
  answer wakes the session.

### Client With a Strict Boundary

When the session's client is listed as card-only in `ask.json`, `ask`
sends Atlas a card with a fixed title, the task and a link, and **never the
question text**. Write the question where the script says (for example as
a comment on the task's ticket). A message tells you when the owner has
answered there; read the answer in the client's tools.

## Message Another Agent

```bash
$ASK message --to <session name> --text "…" [--client <client id>]
```

The message goes through the tasks server, so it reaches a session on any
machine and any Claude account. The client defaults to this session's
client. The receiving session's hooks show it, as they show answers.

## Read Messages Now, or Your Address

```bash
$ASK inbox     # new messages for this session, marked delivered
$ASK whoami    # this session's addresses, account, client and task
```

Other agents reach this session by the first address `whoami` prints. A
session with a name the owner gave goes by that name; any other goes by
`session-` and the start of its id.

## Exit Codes

0 done; 1 Atlas or the tasks server refused or did not answer (the reason is
on stderr); 2 usage. When Atlas cannot be reached, say so to the owner in
the session, and keep working.
