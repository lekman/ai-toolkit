---
paths:
  - "**/*.md"
---

# Markdown

## Links point to a file, never a folder

Every markdown link target must be a **file**. Never link to a bare directory.

- To point at a directory's contents, link to a file inside it — almost always
  that directory's `README.md`.
- A trailing-slash or bare-folder target (`[security](security/)`,
  `[security](security)`) is wrong. Renderers disagree on whether and how to
  resolve it: GitHub may 404 or jump to a file listing, local editors often do
  not resolve it at all, and the link silently breaks when files move.
- Linking to a concrete file is unambiguous everywhere and survives tooling that
  checks links.

### Good

```markdown
See [security/README.md](security/README.md) for the levels.
Read the [standards entry point](standards/CLAUDE.md).
```

### Bad

```markdown
See [security/](security/) for the levels.
Read the [standards](standards) folder.
```

## Use relative paths

Link with repo-relative paths (`standards/SOUL.md`), not absolute paths or full
URLs, so links keep working in clones, forks, and offline checkouts.
