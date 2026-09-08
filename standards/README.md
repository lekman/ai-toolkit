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

## Output Style

Claude Code ships built-in output styles. A style replaces the base system
prompt, so it changes how Claude communicates without changing what it can do:
every built-in style keeps the coding instructions intact. Set one in
`settings.json`, at `~/.claude/settings.json` for all projects or in a project's
`.claude/settings.json` to override it there:

```json
{
  "outputStyle": "Proactive"
}
```

The setting is read when a session starts, so an existing session keeps the
style it began with.

### Use Proactive

**Proactive** suits these standards better than the alternatives. SOUL.md
assumes short prompts, often dictated, where the assistant fills the gaps from
its own expertise. Proactive does exactly that: it executes immediately, makes
reasonable assumptions on low-risk work, and prefers action over planning. It
still expects course corrections mid-task, which is how the AskUserQuestion
rules in SOUL.md are meant to be used.

It cuts interruptions rather than substance. That matters because these files
ask for two things at once: brevity in TONE.md, and analysis, disagreement and
confidence levels in BIAS.md and JUDGMENT.md. A style that trims prose trims the
second one too.

### The Alternatives

| Style         | What it does                                                       | Fit                                                        |
| ------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `Proactive`   | Executes immediately, minimises interruptions, prefers action      | Recommended                                                |
| `Concise`     | Responds tersely, leads with results, skips preamble and narration | Conflicts with BIAS.md (see below)                         |
| `Explanatory` | Explains its implementation choices and codebase patterns          | Useful in an unfamiliar codebase; verbose once you know it |
| `Learning`    | Pauses and asks you to write small pieces of code for practice     | For learning a language or framework, not for delivery     |
| unset         | No override                                                        | The default; TONE.md and SOUL.md still apply               |

`Concise` is the one to be careful with. Its prompt ends by claiming precedence:
where its rules conflict with communication guidance elsewhere in the
instructions, its rules win. One of those rules is to skip hedging and raise a
caveat only when it changes what to do next. BIAS.md asks for the opposite:
always disclose a confidence level when the user asks a question. Setting
`Concise` quietly overrides a standard you wrote on purpose.

None of this weakens the files themselves. A style changes tone and initiative;
SOUL.md, EVIDENCE.md and the rest still govern behaviour.

## Sources

The colon, announcing, antecedent, compression, ending and code-comment rules
in TONE.md are a trimmed adaptation of Andrew Roxby's
[claude-style-patch](https://github.com/andrewroxby/claude-style-patch)
(CC0), rewritten to fit the one-concern-per-file split and the em dash ban.

## Adapt to Taste

These are my preferences, not rules. Edit the files directly. The split is the
only structural commitment: one concern per file. Keeping it that way is what
makes each easy to tune without disturbing the others.
