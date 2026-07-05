# Obsidian

Skills that keep an Obsidian `Dashboard.md` in sync from Claude Code: add, tick,
and list tasks, reconcile a repo's `.tmp/TODO.md`, and load the note you are
working on. The active client is resolved by **discovery** (from your working
directory), so no client name is ever written into a skill.

Invoke as `/obsidian:dashboard`, `/obsidian:add`, `/obsidian:tick`,
`/obsidian:today`, `/obsidian:wrapup`, `/obsidian:sync-todo`, `/obsidian:focus`.

## Privacy model: three tiers, only one is shareable

This plugin is built so that client identities never leave your machine:

1. **Logic (these skills)** — generic. They read a config file and resolve the
   active client at runtime. Safe to share; this is what lives here.
2. **Config (`~/.claude/obsidian.json`)** — your private map of repository path to
   client name, plus the vault location and Jira host. This is the discovery
   source. **Never commit it.** It is not part of this plugin.
3. **Vault (your Obsidian notes)** — the actual dashboard and client data. Reached
   through the filesystem, never through git.

The skills only ever name a client that they read from tier 2 at runtime. Grep
this folder and you will find placeholders (`Acme`), never a real client.

## Setup

Copy the example config and fill it in on the machine that has the vault:

```bash
cp plugins/obsidian/obsidian.example.json ~/.claude/obsidian.json
# then edit ~/.claude/obsidian.json
```

```json
{
  "vault": "/path/to/your/Obsidian/Vault",
  "dashboard": "Dashboard.md",
  "jira_host": "your-org.atlassian.net",
  "clients": {
    "/Users/you/Repo/acme": "Acme",
    "/Users/you/Repo/globex": "Globex"
  },
  "default_client": "Acme"
}
```

`clients` maps a repository path prefix to a client label. The active client is
the **longest** prefix of your current directory, falling back to
`default_client`. That is the whole of "discovery": no name is hardcoded in a
skill, it is looked up from where you are working.

## Using it on an isolated agent

If you run an isolated per-client agent (for example a dedicated macOS user on a
separate machine), sharing these skills through git gives the agent the _logic_.
It still needs two things, and **neither goes through git**:

- **A client-scoped config.** Give that agent an `~/.claude/obsidian.json` whose
  `clients` map contains **only its one client**, provisioned locally on that
  machine. Least privilege: the agent cannot name a client it was never told
  about, so even a full config dump reveals nothing about your other clients.
- **A scoped vault.** The skills read and write files under `vault`. An isolated
  account does not see your primary vault, and your master `Dashboard.md` lists
  every client's tasks. Point that agent at a **per-client** dashboard and vault
  subset, synced back to your master through a private channel (a sync tool, a
  private remote you control), not through this repository.

The rule of thumb: the skill is generic and public; the config is one client and
private; the vault is data and never in git.

## Skills

- **dashboard** — open `Dashboard.md` and report the active client.
- **add** — append `- [ ] <client>: <text>` under today's heading.
- **tick** — mark a task done by substring match, scoped to the active client.
- **today** — list today's open tasks, filtered to the active client.
- **wrapup** — end-of-session multi-select tick across all clients.
- **sync-todo** — reconcile a repo's `.tmp/TODO.md` into the dashboard.
- **focus** — load the most recently edited vault note as working context.
