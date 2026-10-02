# Rules

Reusable path-scoped rule files. Copy a rule into `~/.claude/rules/` to apply
it across all projects, or into a repository's `.claude/rules/` to apply it
there only. The `paths` front matter controls when each rule loads.

- **[Documentation Tone](tone.md)** (`**/*.md`): the concise mechanical
  checks for documentation prose, pointing to the `tone` plugin's skill for
  the full guidance. Plugins cannot ship rule files, so this copy step is the
  distribution mechanism.
- **React layers** (`**/*.ts`, `**/*.tsx`): six rules for a React app split
  into a design system, an app layer, zod contracts and business logic.
  Start with [react-layers.md](react-layers.md), which links the others:
  [react-design-system.md](react-design-system.md) (what a view contains),
  [react-app.md](react-app.md) (state, events, requests and binding),
  [react-contracts.md](react-contracts.md) (one zod schema per API answer),
  [react-logic.md](react-logic.md) (pure rules, I/O behind interfaces) and
  [react-packages.md](react-packages.md) (when a folder becomes a package).
