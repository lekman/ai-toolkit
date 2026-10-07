---
name: files
description: Register a set of temporary files (screenshots, reports, exports, a built folder) on a small files site reachable over Tailscale, and remove them again. The site groups every set under the session that shared it, with the time it was shared and when it is removed. Use when the user says "/share:files <paths>", "share these files", "put the screenshot on the tailnet", "show me that file on my phone", "remove my shared files", or "what is shared".
user-invocable: true
---

# Share Files

Publish files from this machine so the operator can open them on any device on the tailnet,
for example a screenshot from a headless browser that cannot be shown in the chat.

The CLI is `bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts"`. In a clone of the toolkit it is
`bun plugins/share/scripts/share.ts`.

## What a Share Is

A share is one set of files, copied when it is registered, so it keeps what was shared even
if the originals change or a temp folder is cleaned. Each share records:

- the session that shared it: its id, its name (when the session has one) and its working
  directory;
- when it was shared, and when it is removed (24 hours later unless `--ttl` says otherwise).

The files site lists every share grouped by session, newest first, with image previews. It
listens on `127.0.0.1:8765` and is put on the tailnet with `tailscale serve`, so it is not on
the LAN or the internet. State lives in `~/.claude/share/`.

## Register

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" add <path>... \
  --session "${CLAUDE_SESSION_ID}" --title "<what this is, in a few words>" [--ttl 24h]
```

- Always pass `--session "${CLAUDE_SESSION_ID}"` so the share names this session.
- The session's name is looked up from Claude Code's own session file. Pass `--name <name>`
  when the session has no name, so the reader can tell sessions apart.
- `--title` says what the files are, such as "Emulator page, flow picked". Without it, the
  file names are used.
- `--ttl` takes minutes, hours or days: `30m`, `24h`, `7d`.
- A path can be a folder. A folder with an `index.html` is served as a site.

The command starts the files site if it is not running, puts it on the tailnet, and prints
two addresses: the share and the list of all shares. Give the share's address in a fenced
block on its own.

## Remove

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" remove <share-id>...
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" remove --session "${CLAUDE_SESSION_ID}"   # everything this session shared
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" remove --expired
```

Remove only this session's shares unless the operator names others. Expired shares are also
removed by the site every hour and before every `add` or `list`.

## List and Stop

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" list      # id, time, session, title, items, expiry
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" up        # start the site and print its address
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" down      # take it off the tailnet and stop it
```

`down` keeps the shares on disk, so `up` brings them back.

## Rules

- **No secrets, patient data or customer data.** Everyone on the tailnet can open a share.
- **Prefer a short lifetime.** Use the default 24 hours unless the operator asks for longer.
- **Report what was shared.** Say the title, the number of items and when it is removed.
