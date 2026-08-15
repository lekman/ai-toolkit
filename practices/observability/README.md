# Observability

See what the agent is doing: when it needs you, what it is working on, and what
it touches. Notifications come first, because knowing when to look is what makes
the rest optional. Progress and access visibility follow as content lands.

## Notifications

Three techniques, chosen by how far you are from the keyboard.

### At the Keyboard: Remote Control

The simplest, and built in. Set it in `~/.claude/settings.json`:

```json
{ "remoteControlAtStartup": true }
```

You get a phone notification when Claude finishes or asks a question, and can
reply from your phone. Best for normal interactive sessions.

### Away or Long-Running: Pushover

For scheduled tasks, webhook-triggered agents, or long runs where you are not
watching, push to your phone via Pushover:

```bash
bunx @lekman/claude-notify
```

This installs a hook plus a `/remote-notify` toggle skill. It needs Pushover
credentials (`PUSHOVER_USER_KEY`, `PUSHOVER_APP_TOKEN`) in your environment;
never commit them. Distributed as the npm package `@lekman/claude-notify`, not a
plugin, so it is installed with `bunx`, not the marketplace.

### Local Sound: Peon Ping

An audio cue on your machine when something happens. Install from
[peon-ping](https://github.com/lekman/peon-ping).

My customisation makes it signal, not noise: it pings only on **done** and
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
off, a sound means _look now_, not just _something happened_.

Pick one per context rather than stacking them: two channels firing on the same
event trains you to ignore both.

The default installs more event hooks than you need (session start and end among
them): fun for a day, distracting after. But the categories above already do the
job: with `session.start` off, launch and exit are silent without touching the
hooks. Trimming the extra `SessionStart`/`SessionEnd` taps in `settings.json` is
optional tidying, not what quiets them, and a reinstall can put them back, so
let the config own it. Only remove a hook to stop it _running_ (a perf concern),
not to silence it.

## Not Covered Yet

Progress (what the agent is doing right now) and access visibility (which files,
credentials and services it touches) are the other two halves. Neither has a
technique here yet; both are added as content lands.
