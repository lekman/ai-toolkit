# Bedrock

Running Claude Code against the model over AWS Bedrock, and keeping the session
authenticated. Bedrock gives you IAM-scoped access and per-team cost allocation;
AWS SSO gives credentials that refresh instead of being pasted.

## Set It Up with the Built-In Wizard

Run `claude`, then `/setup-bedrock`. It reads your AWS profiles, resolves the
region, checks which Claude models your account can actually invoke, and pins
them into your settings. Use it rather than writing the environment variables by
hand: inference profile IDs are account- and region-scoped, and a wrong one
fails at request time with an unhelpful error.

Two consequences worth knowing:

- **It writes global settings.** Bedrock then applies to every session. If you
  mix backends, [@lekman/claude-bedrock](../../packages/claude-bedrock/README.md)
  gives you one session on Bedrock without changing the global default.
- **`awsAuthRefresh` may replace the hook below.** Claude Code has a first-party
  setting that runs your login command when it detects expired credentials. It
  covers the same ground as the script here, from inside the product. Prefer it;
  keep the hook only where you need behaviour it does not give you.

## Keep the SSO Session Alive

[aws-auto-login.sh](aws-auto-login.sh) is a `SessionStart` hook. On each session
start it checks whether the configured AWS profile still has a valid SSO token
(`aws sts get-caller-identity`). If the token is valid it stays silent. If it is
missing or expired, it runs `aws sso login` for that profile, bounded by a
timeout, and fails open.

Why a hook rather than a manual step or a build-tool task:

- **Automatic and self-healing.** The refresh happens on its own, only when the
  token is actually invalid. Nothing to remember, no task to run first.
- **Silent when valid.** It costs nothing on a session that already has a token.
- **Tied to the session lifecycle.** It runs exactly when a session starts, which
  is when a stale token would otherwise cause a failure part way through.

### Requirements

- `AWS_PROFILE` set to the profile that carries your SSO session and Bedrock
  access (set it in the account, your shell, or `.claude/settings.json` env).
- AWS CLI v2. The `sso-session` config block does not exist in v1.

### Wire It (Opt-In, Per User)

Copy the script into your `.claude/hooks/`, then wire it in
`.claude/settings.local.json`, not the committed `settings.json`, because the
login opens a browser tab and not everyone wants that on every session:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/aws-auto-login.sh\"",
            "timeout": 130
          }
        ]
      }
    ]
  }
}
```

### Interactive Versus Headless

`aws sso login` completes device auth in a browser, so it only works where a
human can click. Wire it on the interactive session (the IDE, or the orchestrator
a human drives). A headless subagent should inherit a token an interactive
session already refreshed, not try to log in itself: there the hook stays silent
(valid token) or fails open (invalid token, no browser) rather than blocking. In
the [orchestrator and subagent](../orchestrator-subagent.md) model this is why
the orchestrator owns the SSO refresh and subagents only consume the token.

### Fail Open

The hook never blocks a session. A missing aws CLI, a missing profile, a login
error, or a timeout all exit 0 and let the normal flow continue. If AWS calls
then fail, run `aws sso login --profile <profile>` by hand.
