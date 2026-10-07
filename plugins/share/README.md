# Share

Share work from this machine with your own devices over Tailscale: a local site such as
Storybook, or a set of temporary files such as screenshots and reports. Nothing goes on the
local network or the internet. Every device on your tailnet can open it, and nobody else.

## Install

```text
/plugin marketplace add lekman/ai-toolkit
/plugin install share@ai-toolkit
```

Needs [Bun](https://bun.sh) and the Tailscale CLI (`tailscale`, or the macOS app).

## Skills

- **[site](skills/site/SKILL.md)** (`/share:site 6006`): puts a site that listens on
  `127.0.0.1:<port>` on the tailnet with `tailscale serve`, checks it answers there, and gives
  the `http://<machine>.<tailnet>.ts.net:<port>/` address.
- **[files](skills/files/SKILL.md)** (`/share:files <paths>`): copies files into a share and
  lists it on a small files site at `http://<machine>.<tailnet>.ts.net:8765/`. The site groups
  shares by the Claude Code session that made them (name, id and working directory) and shows
  when each was shared and when it is removed. Shares are removed after 24 hours by default.

## How the Files Site Works

`scripts/share.ts` is one Bun script with no dependencies. `add` copies the paths into
`~/.claude/share/<share-id>/files/` and writes `share.json` beside them, so two sessions can
share at the same time without a shared index to lock. The site reads those folders on each
request, listens on `127.0.0.1:8765` only, and is put on the tailnet the same way `/share:site`
puts any site there.

The session's name comes from the file Claude Code keeps for each running session in
`~/.claude/sessions/`. That file is not a documented interface, so when it cannot be read the
share shows "unnamed" and the session id, and `--name` can set the name instead.

## Tests

```bash
cd plugins/share/scripts && bun test
```

The tests never call Tailscale and never start the site (`SHARE_NO_TAILNET=1`).
