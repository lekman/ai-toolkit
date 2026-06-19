# Machine security

**Practice:** machine-level security for an interactive or autonomous Claude
session — deny rules that stop the agent reading or clobbering secrets on the
workstation it runs on.

This is **one level** of security and it is context-dependent. On a dedicated
machine that holds no sensitive data, you may not need it at all; on your daily
driver with real credentials, you do. Match the level to what the machine can
lose.

[settings.safety.json](settings.safety.json) is a **fragment**, not a full
config. It holds a `permissions` baseline. Merge it into the `permissions` block
of your own `~/.claude/settings.json` — do not copy the file over the top of
your settings, or you will wipe everything else.

It sets four things:

- **`defaultMode: auto`** — run permissions in auto mode by default. Auto mode
  puts a second agent service and practical safeguards between the agent and
  your machine. Its job is to protect you, your data, and your security — not to
  get the task done. That makes it a guard rail rather than a convenience: it
  slows down or stops actions that put you at risk, even when finishing the task
  would be faster without the check.
- **Reading secrets denied** — `.env` files, private keys, certs, keystores, and
  the on-disk credential stores for SSH, AWS, Azure, gcloud, kube, Docker, GPG,
  npm, and Claude Code itself.
- **Writing those secrets denied** — every read deny on a credential store is
  mirrored by a `Write`/`Edit` deny. Clobbering a credential is as damaging as
  reading it: an overwritten `~/.ssh/authorized_keys` is a backdoor, a rewritten
  `~/.aws/credentials` redirects your cloud calls.
- **Self-mutation denied** — the agent cannot `Write`/`Edit` its own
  `settings.json` (global or project). Without this, an agent in `auto` mode
  could delete these very deny rules and then do as it pleases. This is the rule
  that keeps the others honest. The `**/` glob is deliberate: it covers every
  repo's `.claude/settings.json`, so a repo's guard rails (e.g. a PreToolUse
  hook wired there) survive even when no repo-level protection is applied —
  defense in depth across a misconfigured or isolated box.

## Optional: silence the auto-mode prompt

If auto mode's confirmation prompt nags you every session, you can add
`"skipAutoPermissionPrompt": true` alongside `defaultMode`. It is **not** in the
fragment on purpose: it removes a prompt, not a risk. Treat it as a personal
convenience, not part of the safety baseline — adding it makes the workflow
smoother, not the machine safer.

## Why a deny list is not enough

Deny rules are scoped to a tool. `Read(**/*.pem)` blocks the **Read** tool, but
`Bash(cat key.pem)` is a Bash call and slips straight past it. You can try to
block the shell too (the `Bash(cat ...)` lines do), but it is porous: `head`,
`less`, `tail`, `bat`, `rg`, `xxd`, and `python -c "open(...)"` all read the
same file, and a shell redirect (`> ~/.ssh/authorized_keys`, `tee`) writes one,
none of which a prefix deny reliably catches. Prefix denies stop honest
mistakes, not a determined path.

Two deliberate choices in the list:

- **Self-mutation is scoped to the settings files**, not all of `~/.claude`. A
  blanket `Write(~/.claude/**)` deny would also block memory and plan writes
  that the agent legitimately makes. Blocking `settings.json` /
  `settings.local.json` is the targeted fix; the robust version is a read-only
  mount (below).
- **No Bash write-redirect denies.** `Bash(* > ~/.ssh/*)`-style rules give false
  confidence — the matcher does not parse redirection reliably. The `Write`/
  `Edit` denies cover those tools; the shell gap is closed by isolation, not by
  more rules.

So treat this baseline as one layer. It matters **most** in sessions with no
human approving each step:

- **Local, interactive** — you approve permission prompts, so a slip is caught
  by you. The deny list is a backstop. (If you run `defaultMode: auto` or skip
  the permission prompts, you have removed that human gate — lean harder on the
  rules and on isolation.)
- **Docker / remote Agent SDK** — usually unattended and auto-approved. Here the
  deny list is doing real work, but the durable control is **isolation**: run
  with a least-privilege filesystem, do not mount real credentials, and mount
  the settings read-only so the agent cannot rewrite its own rules — a shell
  bypass then has nothing to reach. Contain the blast radius rather than trying
  to enumerate every dangerous command.

## Keep secrets out of `settings.json`

Do not put live tokens in the `env` block of `settings.json`. Anything that
reads the file — including an agent in a less-trusted session — gets them. Use
your shell environment or a secret manager, and never commit a populated
`settings.json` to a shared repo.
