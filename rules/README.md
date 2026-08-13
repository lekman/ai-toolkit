# Rules

Reusable path-scoped rule files. Copy a rule into `~/.claude/rules/` to apply
it across all projects, or into a repository's `.claude/rules/` to apply it
there only. The `paths` front matter controls when each rule loads.

- **[Documentation Tone](tone.md)** (`**/*.md`): the concise mechanical
  checks for documentation prose, pointing to the `tone` plugin's skill for
  the full guidance. Plugins cannot ship rule files, so this copy step is the
  distribution mechanism.
