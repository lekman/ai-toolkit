# Observability

**Practice:** see what the agent is doing — when it needs you, what it is working
on, and what it touches. This area starts with **notifications** (knowing when to
look) and will grow to cover progress and access visibility.

## Notifications

Three techniques, chosen by how far you are from the keyboard.

### At the keyboard — remote control

The simplest, and built in. Set it in `~/.claude/settings.json`:

```json
{ "remoteControlAtStartup": true }
```

You get a phone notification when Claude finishes or asks a question, and can
reply from your phone. Best for normal interactive sessions.

### Away or long-running — Pushover

For scheduled tasks, webhook-triggered agents, or long runs where you are not
watching, push to your phone via Pushover:

```bash
bunx @lekman/claude-notify
```

This installs a hook plus a `/remote-notify` toggle skill. It needs Pushover
credentials (`PUSHOVER_USER_KEY`, `PUSHOVER_APP_TOKEN`) in your environment —
never commit them. Distributed as the npm package `@lekman/claude-notify`, not a
plugin, so it is installed with `bunx`, not the marketplace.

### Local sound — peon ping

An audio cue on your machine when something happens. Install from
[peon-ping](https://github.com/lekman/peon-ping).

My customization makes it signal, not noise — it pings only on **done** and
**input needed** (plus resource limits), and never for subagents. In
`~/.claude/hooks/peon-ping/config.json`:

```json
{
  "categories": {
    "session.start": false,
    "task.acknowledge": false,
    "task.complete": true,
    "task.error": false,
    "input.required": true,
    "resource.limit": true,
    "user.spam": false
  },
  "suppress_subagent_complete": true
}
```

`task.complete` is "done", `input.required` is "waiting on you". With the rest
off, a sound means *look now*, not just *something happened*.

The default installs more event hooks than you need (session start and end among
them) — fun for a day, distracting after. But the categories above already do the
job: with `session.start` off, launch and exit are silent without touching the
hooks. Trimming the extra `SessionStart`/`SessionEnd` taps in `settings.json` is
optional tidying, not what quiets them — and a reinstall can put them back, so
let the config own it. Only remove a hook to stop it *running* (a perf concern),
not to silence it.

## More to come

Observability is broader than notifications — seeing the agent's progress, the
files and resources it accesses, and what it changes. Added as content lands.
