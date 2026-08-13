# Evidence

## Do not assert what you have not checked

The rules below are one idea in three places: a claim written down is load-bearing,
because the next reader trusts it instead of checking. Each covers a different
source of a confident wrong statement.

A crash is cheap — it stops you. Plausible wrong output is expensive, because it
gets written into a document and acted on.

## Your own command's output can be silently wrong

**BEFORE** reading a result, check that the command could produce it. A loop that
runs once instead of five times returns a real-looking answer.

The recurring ones:

- **zsh does not word-split unquoted variables.** `for r in $REPOS` runs **once**
  with the whole string as one value. `set -- $pair` does not split. This is a zsh
  behaviour, not a bash one, so examples copied from anywhere else are wrong here.
  - bad `for r in $REPOS; do ...`
  - good `repos=(a b c); for r in "${repos[@]}"; do ...`
  - explicit split when you must: `${=var}`
- **Backticks in JMESPath are JSON literals.** `` `15.18` `` is the _number_
  15.18 and never equals the string `"15.18"`, so the filter matches nothing and
  reports zero. Use `'15.18'`.
- **A zero is a claim.** "No results", "0 datapoints" and "not found" are answers
  that need the same scrutiny as any other. Confirm the query would have returned
  something if something were there.

## Verify external behaviour before writing it into a comment or doc

**NEVER** state how an external system behaves from expectation. Check it, then
write what you observed and what showed it.

This applies to cloud provider semantics, third-party API behaviour, and any
"X implies Y" about a system you do not control.

- bad `# a replica follows its source` — an assumption, stated as fact
- good `# Declared, not inherited — the replica reached 15.17 while its primary
sat on 15.9` — an observation, with the evidence

Where a confident wrong statement is worse than silence — regulated, audited or
customer-facing artefacts — say what is unverified rather than smoothing over it.

## The current state is not `main`

**BEFORE** editing shared configuration — an allow-list, a module input, a
workflow, anything two people touch — check the open pull requests on the repo and
grep their diffs for the same file.

Deriving "what exists today" from `main` is wrong whenever the question is _what
will call this_ or _what else is changing this_. The missing information is in an
open PR, not in the code.

```sh
gh pr list --state open
gh pr diff <n> -- path/to/shared/file
```

This is about collision and completeness, not permission. It costs one command and
prevents both a duplicate change and a call graph derived with a caller missing.
