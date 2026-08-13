# @lekman/claude-foundry

Run one Claude Code session against Claude on Microsoft Foundry, without
switching your global settings.

## Use

```bash
npx @lekman/claude-foundry
```

Or install once:

```bash
npm install -g @lekman/claude-foundry
claude-foundry
```

The published package bundles its dependencies, so `npx` installs nothing.
Node 20 or later is the only requirement.

## Why This Exists

Claude Code speaks to Foundry natively: set `CLAUDE_CODE_USE_FOUNDRY=1` and it
works. Two things make that harder than the same move on AWS:

- **There is no setup wizard.** Bedrock has `/setup-bedrock` and Google Cloud
  has its own. Foundry has neither, so environment variables are the only path.
- **Nothing is checked before the first request.** Foundry performs no startup
  model check, and the endpoint URL is built straight from the resource name. A
  wrong deployment name, a placeholder resource, or an unset model pin surfaces
  as a failed prompt rather than a configuration error.

So this does three jobs:

**Setup, since there is no wizard.** `--setup` asks the Azure CLI which resource
you have, which Claude models your region offers, how much quota each one has,
and what is already deployed. It creates the models that are missing and writes
the env file from the answers, so no deployment name is ever retyped.

**Per-invocation choice.** The environment reaches one child process and nothing
else, so these coexist in the same terminal:

```bash
claude              # whatever your global settings say
claude-foundry      # this one session on Foundry
```

**A pre-flight, since nothing upstream provides one.** Before launching it
rejects a resource name that is still a placeholder or is actually a URL,
rejects a resource name and a base URL set together, warns about model aliases
with no pinned deployment, and, when the Azure CLI is the credential in use,
checks that it can still mint a token, rather than letting an expired login
surface mid-request as what looks like a Foundry outage.

## Commands

```bash
claude-foundry                    # launch
claude-foundry --setup            # deploy the models, write the env file
claude-foundry --status           # what would be used; changes nothing
claude-foundry --resource <name>  # override the Azure resource
claude-foundry --no-login         # fail rather than opening a browser
claude-foundry --no-repair        # leave global settings alone
```

Reserved flags are handled here. The first token that is not one of them ends
the parsing, and everything from there goes to `claude` untouched:

```bash
claude-foundry -p "review the diff"
claude-foundry -- --help          # claude's help, not this one
```

## Set Foundry Up

Create the resource yourself, in the [Foundry portal](https://ai.azure.com/).
That step fixes a region, and a region is a data-residency decision that should
not sit behind a prompt, so `--setup` does not do it for you.

Everything after that is `--setup`:

```bash
claude-foundry --setup --dry-run   # show the plan, create nothing
claude-foundry --setup             # do it
```

It finds your `AIServices` resource (asking which, if you have several), reads
the Claude models your region offers, checks the quota granted for each, reuses
any Claude deployment already on the resource, creates only what is missing, and
writes `~/.claude/foundry.env`. It shows the whole plan and waits for a yes
before creating anything.

| Flag | Effect |
| ---- | ------ |
| `--dry-run` | Print the plan, change nothing |
| `--yes` | Skip the confirmation. Required when stdin is not a terminal |
| `--upgrade` | Deploy the newest model even when an older one in the family is already deployed |
| `--capacity <n>` | SKU capacity in thousands of tokens per minute. The catalogue default is 10, which throttles a real session. Raise it if you have the quota |
| `--hosting azure\|anthropic` | Force a hosting variant instead of taking the catalogue default |
| `--org`, `--industry`, `--country` | Provide the Anthropic details below instead of being asked |

**Quota is the usual blocker.** Anthropic model quota starts at zero and is
granted per model. The models appear in the catalogue either way, which is why the
portal lets you deploy and then fails. `--setup` checks first and tells you which
models have quota, and if a newer model has none but an older one in the same
family does, it deploys the older one rather than failing.

Two things it will tell you that the portal does not. An initial allocation comes
from a support ticket, not the quota-increase form: that form raises an
allocation that already exists. And Claude on Foundry is an Azure Marketplace
offer, so a Visual Studio/MSDN, MPN, free-trial, student, or sponsored
subscription cannot buy it and stays at zero in every region no matter how often
you ask; `--setup` names the subscription type rather than letting you chase the
quota form.

**Region matters more than usual.** Claude is offered in far fewer regions than
the rest of Foundry: `swedencentral` and `eastus2` carry the full set, a handful
of US regions carry a subset, and most regions including all of the UK and the
rest of Europe carry none. The resource's region decides this, so check before
you create one.

**Anthropic wants three details.** A Claude deployment carries a
`modelProviderData` block (organisation name, industry, and two-letter country
code) which signs the marketplace agreement. The portal does not ask for all
three, which is why portal deployments fail with `InvalidModelProviderData`, and
`az cognitiveservices account deployment create` has no flag for it either.
`--setup` asks, then creates the deployment through the management API directly.
The values are stored on the deployment in Azure, not in your env file.

**Hosting decides where inference runs**: on Azure or on Anthropic
infrastructure. If the reason you are on Azure is a compliance boundary rather
than billing convenience, set `--hosting azure` rather than taking the default.

### Or Write the Env File by Hand

It is shell-style and read, not executed: `export KEY=value`, plain
`KEY=value`, quoted values, and `#` comments:

```bash
export ANTHROPIC_FOUNDRY_RESOURCE=your-resource
export ANTHROPIC_DEFAULT_OPUS_MODEL='claude-opus-4-8'
export ANTHROPIC_DEFAULT_SONNET_MODEL='claude-sonnet-5'
export ANTHROPIC_DEFAULT_HAIKU_MODEL='claude-haiku-4-5'
```

**Pin every model you use.** An unpinned alias falls back to Claude Code's
built-in default for Foundry, which lags the newest release and may not exist in
your account. Because Foundry does not check models at startup, that fails
at the first prompt. `--status` lists anything unpinned.

Background work such as session titles uses the small, fast model. On Foundry
that defaults to your primary model, because not every account has a Haiku
deployment. Pin `ANTHROPIC_DEFAULT_HAIKU_MODEL` to use Haiku instead.

## Authenticating

Three options, in the order Claude Code decides between them:

| Set                            | Meaning                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_FOUNDRY_AUTH_TOKEN` | A bearer token Entra ID already issued. Needs Claude Code 2.1.203 or later.                                     |
| `ANTHROPIC_FOUNDRY_API_KEY`    | The key from **Endpoints and keys** in the portal.                                                              |
| Neither                        | The Azure SDK default credential chain: `az login` on a laptop, a service principal or managed identity in CI. |

`Azure AI User` or `Cognitive Services User` covers the permissions needed to
invoke a deployment.

The session pre-flight only runs for the credential chain, and only when the
Azure CLI is the link that would answer it. If a service principal or managed
identity is configured, the check is skipped rather than reported as a problem
it cannot see. `/logout` inside Claude Code does nothing on Foundry: auth is
Azure's.

## Where Configuration Comes From

Checked in order:

| Source                       | Use it when                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `.claude/foundry.env` in cwd | A repo must run against a specific resource: commit it, and everyone in the directory picks it up |
| `~/.claude/foundry.env`      | Your own default across repos                                                                      |
| `~/.claude/settings.json`    | Only if you put Foundry variables there by hand                                                    |

Nothing is exported into your shell and no wrapper script is written. Keys are
handed to the child process and never printed, including by `--status`.

Foundry variables found in `~/.claude/settings.json` are moved into
`~/.claude/foundry.env`, because settings `env` applies to every session: left
there, bare `claude` is on Foundry too and there is no way back. Model pins are
only moved when a Foundry-specific variable sits beside them, so a Bedrock setup
that pins models the same way is left alone. `--no-repair` skips this.

## Requirements

- Claude Code on your PATH.
- An Azure subscription with Foundry access, and permission to create resources
  and deployments.
- Granted quota for the Claude models you want. It starts at zero.
- The Azure CLI. `--setup` requires it. For launching it is optional: without it
  the launch still works, but you lose the pre-flight and an expired login fails
  later instead.

## Know Before You Move

Foundry carries less of the Claude API than the first-party endpoint. Most of
what Claude Code uses is available but in beta there: extended and adaptive
thinking, effort, prompt caching, PDF input, structured outputs. Message
Batches, the Models API, and Managed Agents are absent. Fine for a coding
session; check before you port an application.

## Undo

```bash
npm uninstall -g @lekman/claude-foundry
rm ~/.claude/foundry.env        # if you wrote one
```

`claude` itself is never modified.

## Contributing

Building, testing, and releasing: [CONTRIBUTING.md](CONTRIBUTING.md).
