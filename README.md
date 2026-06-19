# ai-toolkit

My practices, tools, and workflows for working with Claude. Not an authority —
just what works for me. Anthropic (Claude) only.

## The idea

A capable assistant defaults to *fast* and *agreeable*. Neither is the same as
*helpful*. Everything here re-aims it at one job: helping me make better
decisions. Each practice below names the concerns it addresses — a concern is a
default failure mode and its corrective.

## Practices

### Standards

Standardise my Claude context — identity, tone, and reasoning — so the assistant
behaves the same way across every project and machine.

<details><summary>Installation</summary>

Copy `standards/CLAUDE.md` and the files it imports into `~/.claude/`, keeping
them in the same directory (the `@`-imports resolve relative to `CLAUDE.md`).
If you already have a `~/.claude/CLAUDE.md`, append the imports instead of
overwriting it. Start a new session and they apply to every project.

</details>

<details><summary>Concerns</summary>

#### Truth over agreement
It tells me what I want to hear. Instead: name the biases, show contrary
evidence, state confidence, never assume I'm right.
→ [standards/BIAS.md](standards/BIAS.md), [standards/TONE.md](standards/TONE.md)

#### Judgment over speed
It answers fast because fast *feels* helpful. Instead: slow down when the stakes
justify it. Fast does not mean good.
→ [standards/JUDGMENT.md](standards/JUDGMENT.md)

#### Proportion over perfection
It gold-plates, or it ships sloppy — both ignore what the work is worth.
Instead: match effort to the cost of being wrong. Perfection is the enemy of
good.
→ [standards/PROPORTION.md](standards/PROPORTION.md)

#### Clarity over volume
Verbose, jargon-heavy output. Instead: brief, plain, readable by non-native
speakers.
→ [standards/TONE.md](standards/TONE.md)

#### Partnership over order-taking
It waits for perfect orders, or guesses silently. Instead: fill the gaps with
expertise, and surface real decisions as choices I can pick.
→ [standards/SOUL.md](standards/SOUL.md)

</details>

### Security

Security settings by level. Apply the levels that match what the machine can
afford to lose — not all of them by default.

<details><summary>Installation</summary>

Pick the levels that fit the machine. For machine level, merge the `permissions`
block of `security/machine/settings.safety.json` into your
`~/.claude/settings.json` — merge, do not copy the file over the top. See
[security](security/README.md) for the levels and the reasoning.

</details>

<details><summary>Concerns</summary>

#### Risk over rules
Blanket lockdown or blanket trust. Instead: protection proportional to the cost
of failure; contain the blast radius by isolation.
→ [security](security/README.md)

</details>
