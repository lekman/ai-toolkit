# Copilot instructions

`lekman/ai-toolkit` holds practices, standards, security and privacy settings,
plugins, skills and runnable TypeScript packages for working with Claude. It is
public.

## Pull requests to skip

Stop and post no review for pull requests from these branches. They are
machine-generated, their contents are mechanical, and a review comment on them
is noise that trains people to skim the ones that matter.

- `release-please--*` — a version bump and a generated changelog. The content
  is produced from commit messages that were already reviewed when they landed.
- `dependabot/*` — a dependency or action version bump. What matters is whether
  the upgrade builds and passes, which continuous integration answers, not
  whether the diff reads well.

Exit early on those. Everything below applies to human pull requests.

## What to look at closely

- **This repository is public.** Client, supplier and project names must not
  appear anywhere, including commit messages, test fixtures and comments. Use
  placeholders — Acme, Globex, PROJ-123. A guard enforces this, but a review is
  the cheaper place to catch it.
- **Documentation is the product here.** Prose that is vague, or that hedges
  where it should state a fact, is a defect in this repository in a way it
  might not be elsewhere.
- **Packages are published.** Check that `files` in package.json still excludes
  sources and tests, and that anything new in `exports` points at a path the
  package actually ships.

## Conventions

Written for readers whose first language is not English: short sentences, plain
words, no jargon. Avoid empty modifiers — comprehensive, robust, seamless,
powerful — in both prose and review comments.

Clean architecture applies to `packages/`: `types.ts`, `{name}.ts`,
`interfaces.ts`, `{domain}.system.ts`, `index.ts`. Anything performing I/O
carries the `.system.ts` suffix and holds no business logic.
