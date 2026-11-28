# Record Formats

The two files a run writes. Read this before writing either one. The validator
refuses any field that is not listed here.

## `run.json`

```json
{
  "commit": "33df8b3b4b18c9da693fe1742e4a01f738e0be02",
  "dirty": false,
  "scope": { "kind": "repository" },
  "status": "complete",
  "ran_target_code": false,
  "reviewed_paths": ["src/server.js", "src/auth.js", "src/routes/notes.js"],
  "candidates": ["notes-read-no-owner-check", "proxy-header-trust"],
  "gaps": [
    { "area": "src/routes/admin.js", "reason": "Not read in this run." }
  ],
  "hardening": ["Password hashes use a fast hash with no salt."]
}
```

| Field             | Rule                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `commit`          | The full commit from `git rev-parse HEAD`, 40 characters                                                     |
| `dirty`           | `true` when `git status --porcelain` printed anything. The review then read a clone at the commit            |
| `scope`           | `{"kind": "repository"}`, `{"kind": "paths", "paths": [...]}` or `{"kind": "diff", "base": "<full commit>"}` |
| `status`          | `complete`, or `incomplete` with an `incomplete_reason`                                                      |
| `ran_target_code` | `true` if any agent ran the target's code. Then add `isolation`, as the request gave it                      |
| `reviewed_paths`  | Every file that was read, relative to the repository. Never empty                                            |
| `candidates`      | The fingerprint of every candidate the hunt produced, written before verification                            |
| `gaps`            | Parts in scope that were not read, or leads that were not followed, each with a reason                       |
| `hardening`       | Weak practice with no crossed boundary. These are notes and never records                                    |

## `findings.json`

A list, sorted by `fingerprint`. Every record has these fields.

| Field         | Rule                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `verdict`     | `confirmed`, `needs_validation` or `rejected`                                                                                                 |
| `fingerprint` | A short name for the root cause, from the code and not from the run, such as `notes-read-no-owner-check`. Letters, digits and `. _ : / @ + -` |
| `title`       | One line                                                                                                                                      |
| `description` | What goes wrong, in two or three sentences                                                                                                    |
| `root_cause`  | The one thing in the code that causes it                                                                                                      |
| `trace`       | The path through the code, as below                                                                                                           |
| `found_by`    | Which pass found it: `first-pass`, `second-pass` or `both`                                                                                    |
| `verified_by` | The name of the agent that checked it. Never the same as `found_by`                                                                           |

A trace is a list of `{kind, file, line, note}`. With one entry, `kind` is
`entrypoint` or `sink`. With more, the first is `entrypoint`, the last is
`sink` and the rest are `propagation`. `file` is relative to the repository.

### `confirmed`

```json
{
  "verdict": "confirmed",
  "fingerprint": "notes-read-no-owner-check",
  "title": "Note read has no owner check",
  "description": "Reading a note by id returns it to any signed-in user.",
  "root_cause": "The read handler omits the owner check that update and delete use.",
  "trace": [
    {
      "kind": "entrypoint",
      "file": "src/routes/notes.js",
      "line": 28,
      "note": "Any signed-in user gives a note id."
    },
    {
      "kind": "sink",
      "file": "src/routes/notes.js",
      "line": 29,
      "note": "The note is read by id alone."
    }
  ],
  "found_by": "first-pass",
  "verified_by": "verifier-1",
  "attacker": "A signed-in user with their own account.",
  "boundary": "Only the owner may read a note.",
  "result": "Another user's note is returned.",
  "severity": "high",
  "severity_reason": "Every note of every user can be read by any account.",
  "method": "source",
  "evidence": "The handler queries by id and returns the row. No other layer checks the owner.",
  "fix": "Call the owner helper in the read handler, as update and delete do."
}
```

`method` is `source` when the verifier checked by reading. It is `local` only
when the target was run, and the record then also has `steps`, a list of what
was run.

### `needs_validation`

The common fields, plus `blocker` and `plan`. It has no severity and no fix.

```json
{
  "blocker": "Whether the proxy in front of the service removes this header is not in the repository.",
  "plan": "Ask the owner of the proxy whether a request from outside can carry the header."
}
```

### `rejected`

The common fields, plus `reason`. Keep rejected records. A later run reads
them and does not raise the same claim again.

```json
{
  "reason": "The value is looked up in a fixed list before it reaches the query."
}
```
