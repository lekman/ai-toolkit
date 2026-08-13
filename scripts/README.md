# scripts

Repository-level checks. Not published, not part of any plugin: these guard
this repo itself.

## Keeping Client Content Out of a Public Repo

This repo is public and is written while doing client work. A client name, one
of their repository names, a ticket key or a meeting title reaching it is a
confidentiality problem, and the value of catching it is entirely in _when_.

Three moments, three commands:

| When                 | Command                                        | Scans                                |
| -------------------- | ---------------------------------------------- | ------------------------------------ |
| Every commit         | automatic, via the hook                        | the staged content                   |
| While working        | `scripts/check-no-client-content.sh`           | tracked **and** untracked files      |
| Before trusting main | `scripts/check-no-client-content.sh --history` | every blob in every reachable commit |

Install the hook once per clone:

```bash
scripts/install-hooks.sh
```

It points `core.hooksPath` at [.githooks](../.githooks/pre-commit), so the hook
is version-controlled rather than sitting unshared in `.git/hooks` waiting to
be lost on the next clone.

### The Term List Is Local, on Purpose

Terms live in `scripts/client-terms.txt`, one extended-regex per line, and that
file is **gitignored**. A committed list of client names would be exactly the
leak the check exists to prevent. Start from
[client-terms.example.txt](client-terms.example.txt), which ships with none.

No list means the check skips and prints why. A contributor who works with no
clients is never blocked, and CI, which has no list, never fails on it.

### Why All Three Modes Exist

Each of the first two was added after the mode before it let something through:

- **Working-tree mode** first scanned `git ls-files`, which is tracked files
  only. A brand-new file is untracked until it is staged, which is exactly when
  a leak is most likely, so it reported "clean" for a file it had never opened.
  It now scans tracked and untracked-but-not-ignored together.
- **Staged mode** reads staged _content_ with `git show :file`, not the file on
  disk. A partially staged file differs from its working copy, and the commit
  records the staged version.
- **History mode** exists because a working tree going clean does not clean the
  history behind it. A fix commit corrects the tip and leaves the earlier blob
  exactly where it was: still published, still fetchable. Only a history
  rewrite removes it.

Run `--history` before assuming the published repo is clean. It is the check
that answers the question people actually mean.
