# @lekman/claude-bedrock

Run one Claude Code session against AWS Bedrock, without switching your global
settings.

## Use

```bash
npx @lekman/claude-bedrock
```

Or install once:

```bash
npm install -g @lekman/claude-bedrock
claude-bedrock
```

The published package bundles its dependencies, so `npx` installs nothing.
Node 20 or later is the only requirement.

## What This Is Not

**It does not set Bedrock up.** Claude Code ships `/setup-bedrock`, a wizard
that detects your AWS profiles, resolves your region, checks which Claude models
your account can actually invoke, and pins them. That last part is the fiddly
bit: inference profile IDs are account- and region-scoped, and a wrong one
fails at request time with an unhelpful error. Use the wizard; this tool does
not duplicate it.

## What It Adds

One thing: **per-invocation choice.**

`/setup-bedrock` writes to `~/.claude/settings.json`, which is global. Turning
Bedrock on turns it on for every session. `claude-bedrock` reads the
configuration, hands it to a single child process, and launches, so these
coexist in the same terminal:

```bash
claude              # whatever your global settings say
claude-bedrock      # this one session on Bedrock
```

It also checks your AWS session before launching, rather than letting an expired
SSO token surface mid-request as what looks like a Bedrock outage.

## Commands

```bash
claude-bedrock                    # launch
claude-bedrock --status           # what would be used; changes nothing
claude-bedrock --profile <name>   # override the AWS profile
claude-bedrock --no-login         # fail rather than opening a browser
claude-bedrock --no-repair        # leave global settings alone
```

Reserved flags are handled here. The first token that is not one of them ends
the parsing, and everything from there goes to `claude` untouched:

```bash
claude-bedrock -p "review the diff"
claude-bedrock -- --help          # claude's help, not this one
```

## Where Configuration Comes From

Checked in order:

| Source                       | Use it when                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `.claude/bedrock.env` in cwd | A repo must run on a specific account: commit it, and everyone in the directory picks it up |
| `~/.claude/bedrock.env`      | Your own default across repos                                                               |
| `~/.claude/settings.json`    | Written by `/setup-bedrock`. Read, then moved into the env file above. See below            |

An env file is shell-style and read, not executed: `export KEY=value`, plain
`KEY=value`, quoted values, and `#` comments:

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION=eu-west-1
export AWS_PROFILE=your-profile
export ANTHROPIC_DEFAULT_OPUS_MODEL='arn:aws:bedrock:<region>:<account-id>:application-inference-profile/<id>'
```

Pin models by inference profile ID (`us.anthropic.claude-opus-4-8`) or by
application inference profile ARN. Bedrock needs the cross-region form with a
region prefix: bare model IDs do not work on the Invoke API. Region prefixes
differ by partition (`us.`, `eu.`, `us-gov.` in GovCloud).

Nothing is exported into your shell and no wrapper script is written.

Bedrock variables found in `~/.claude/settings.json` are moved into
`~/.claude/bedrock.env`, because settings `env` applies to every session and
outranks anything a parent process exports. Left there, bare `claude` is on
Bedrock too and there is no way back, which makes this launcher pointless. So
every run checks and repairs it, and `/setup-bedrock` can be re-run at any time:
the next launch picks up the new values the same way. Settings win on conflict,
because whoever just ran the wizard has the values their account can invoke.

Model pins are only moved when a Bedrock-specific variable sits beside them, so
a Foundry setup that pins models through the same names is left alone.
`--no-repair` skips the whole step and reads the variables where they are.

## Requirements

- Claude Code on your PATH.
- The AWS CLI, for the session check. Without it the launch still works; you
  lose the pre-flight and an expired token fails later instead.
- Bedrock model access enabled in the account, and IAM permissions covering
  `bedrock:InvokeModel`, `InvokeModelWithResponseStream`, `ListInferenceProfiles`,
  and `GetInferenceProfile`.

## Undo

```bash
npm uninstall -g @lekman/claude-bedrock
rm ~/.claude/bedrock.env        # if you wrote one, or the repair did
```

The `claude` binary is never modified. `~/.claude/settings.json` is, but only to
move Bedrock variables out of it. To put them back, copy them from the env file
into the `env` block before deleting it, or just re-run `/setup-bedrock`.

## Contributing

Building, testing, and releasing: [CONTRIBUTING.md](CONTRIBUTING.md).
