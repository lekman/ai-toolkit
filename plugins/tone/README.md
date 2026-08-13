# Tone

Documentation tone as a plugin: one skill that carries the house writing
rules for markdown, Word, PDF, and HTML deliverables, so every session and
machine writes documentation the same way.

The skill consolidates the format-independent rules from
[standards/TONE.md](../../standards/TONE.md) and the generic parts of the
blog writing rules in `lekman/web-static`. Blog posts are out of scope on
purpose: the `lekman-blog` skill owns that voice, and this plugin must not
compete with it.

## Install

```text
/plugin marketplace add lekman/ai-toolkit
/plugin install tone@ai-toolkit
```

The skill activates when Claude writes or reviews documentation, or invoke it
directly with `/tone:write`.

## The Companion Rule

Plugins cannot ship rule files, so the path-scoped rule lives at
[rules/tone.md](../../rules/tone.md) in this repository. Copy it into
`~/.claude/rules/` (all projects) or a repository's `.claude/rules/` (that
repository only). The rule carries the concise mechanical checks and points
back to this skill for the full guidance, scoped to `**/*.md` so it loads
whenever a markdown file is touched.

## What the Skill Governs

- **Voice:** plain language, brevity, active voice, measured confidence,
  UK English.
- **Banned constructions:** empty modifiers, filler phrases, em dashes,
  hyphenated emphasis.
- **Structure:** reader-first framing, title case headings, at most three
  heading levels, one idea per chunk, link text from the target's title.
- **Export safety:** no horizontal rules (they become page breaks in Word
  and PDF), kebab-case file names.

Format mechanics stay with the format skills (docx, pdf, pptx). Accuracy
always supersedes tone: the skill never trades correctness for style.
