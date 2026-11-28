---
paths:
  - "**/*.md"
---

# Markdown

## Links Point to a File, Never a Folder

Every markdown link target must be a **file**. Never link to a bare directory.

- To point at a directory's contents, link to a file inside it, almost always
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

## Use Relative Paths

Link to a file in this repository with a repo-relative path
(`standards/SOUL.md`), not an absolute path or a full URL, so the link keeps
working in clones, forks, and offline checkouts.

This applies to files in this repository only. A link to another site, such
as a vendor's documentation or a blog post, uses its full URL.
