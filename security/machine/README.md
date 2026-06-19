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

It sets three things:

- **`defaultMode: auto`** — run permissions in auto mode by default. Auto mode
  puts a second agent service and practical safeguards between the agent and
  your machine. Its job is to protect you, your data, and your security — not to
  get the task done. That makes it a guard rail rather than a convenience: it
  slows down or stops actions that put you at risk, even when finishing the task
  would be faster without the check.
- **Reading secrets denied** — `.env` files, private keys, certs, keystores, and
  the on-disk credential stores for SSH, AWS, Azure, gcloud, kube, Docker, npm,
  and Claude Code itself.
- **Writing `.env` denied** — so the agent cannot clobber your environment
  files.

## Why a deny list is not enough

Deny rules are scoped to a tool. `Read(**/*.pem)` blocks the **Read** tool, but
`Bash(cat key.pem)` is a Bash call and slips straight past it. You can try to
block the shell too (the `Bash(cat ...)` lines do), but it is porous: `head`,
`less`, `tail`, `bat`, `rg`, `xxd`, and `python -c "open(...)"` all read the
same file and you cannot enumerate every reader. Prefix denies stop honest
mistakes, not a determined path.

So treat this baseline as one layer. It matters **most** in sessions with no
human approving each step:

- **Local, interactive** — you approve permission prompts, so a slip is caught
  by you. The deny list is a backstop. (If you run `defaultMode: auto` or skip
  the permission prompts, you have removed that human gate — lean harder on the
  rules and on isolation.)
- **Docker / remote Agent SDK** — usually unattended and auto-approved. Here the
  deny list is doing real work, but the durable control is **isolation**: run
  with a least-privilege filesystem and do not mount real credentials, so a
  shell bypass has nothing to reach. Contain the blast radius rather than trying
  to enumerate every dangerous command.

## Keep secrets out of `settings.json`

Do not put live tokens in the `env` block of `settings.json`. Anything that
reads the file — including an agent in a less-trusted session — gets them. Use
your shell environment or a secret manager, and never commit a populated
`settings.json` to a shared repo.
