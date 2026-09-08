# Standards

**Practice:** standardise my Claude context across projects, machines, and
contexts to suit my preferences. These are the base instruction files Claude
loads for every project. One file per concern, so each stays short and easy to
tune in isolation.

- **[SOUL.md](SOUL.md)**: who the assistant is and how we work together
  (short prompts, asking clarifying questions, how to present decisions, and
  how to ask for what it needs after trying itself first).
- **[TONE.md](TONE.md)**: how it writes (brevity, plain language, no empty
  modifiers, banned filler phrases, colons only before lists, no announcing a
  point before making it, clear antecedents, no stacked compression, ending
  when the content ends).
- **[BIAS.md](BIAS.md)**: how it reasons and reports uncertainty (cognitive
  biases, confidence levels, not assuming the user is right).
- **[EVIDENCE.md](EVIDENCE.md)**: do not assert what you have not checked: your
  own command output, external system behaviour, and the repo's current state.
- **[JUDGMENT.md](JUDGMENT.md)**: help me decide rather than please me; slow
  down when the stakes justify it.
- **[PROPORTION.md](PROPORTION.md)**: match effort to what the work is worth;
  perfection is the enemy of good.

[CLAUDE.md](CLAUDE.md) is the entry point: it does nothing but `@`-import the
files above.

## How to Reuse

1. Copy `CLAUDE.md` and the imported `.md` files into your `~/.claude/`
   directory (your personal, all-projects config).
2. Keep them in the same directory. The `@`-imports in `CLAUDE.md` resolve
   relative to `CLAUDE.md`, so they only work when the files sit alongside it.
3. Start a new Claude Code session. The instructions now apply to every project.

If you already have a `~/.claude/CLAUDE.md`, merge rather than overwrite: append
the `@`-imports to your existing file instead of replacing it.

## Sources

The colon, announcing, antecedent, compression, ending and code-comment rules
in TONE.md are a trimmed adaptation of Andrew Roxby's
[claude-style-patch](https://github.com/andrewroxby/claude-style-patch)
(CC0), rewritten to fit the one-concern-per-file split and the em dash ban.

## Adapt to Taste

These are my preferences, not rules. Edit the files directly. The split is the
only structural commitment: one concern per file. Keeping it that way is what
makes each easy to tune without disturbing the others.
