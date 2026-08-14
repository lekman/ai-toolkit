# Microsoft Foundry

Running Claude Code against the model on Azure, and keeping the session
authenticated. Foundry gives you Entra ID identity, RBAC, Azure networking, and
one bill; it is the natural choice when the rest of your estate is already
there.

Claude Code supports it natively: set `CLAUDE_CODE_USE_FOUNDRY=1` and it works.
What it does not have is the scaffolding Bedrock and Google Cloud got, and that
absence shapes everything below.

## There Is No Wizard

Bedrock has `/setup-bedrock`. Google Cloud has its own. Foundry has neither, so
environment variables are the only path in. That has two consequences worth
knowing before you commit a team to it.

**Nothing verifies your configuration.** Foundry performs no startup model check,
and the endpoint URL is built directly from the resource name. A resource name
left as a placeholder, or a deployment name that does not exist, is not reported
as a configuration problem: it surfaces as a failed request on the first
prompt, which reads like an outage.

**Model pins are mandatory in practice.** An unpinned alias falls back to Claude
Code's built-in default for Foundry, which lags the newest release and may not
exist in your account. Combined with the missing startup check, an unpinned
`opus` on an account without that exact deployment fails at first use. Pin
`ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, and
`ANTHROPIC_DEFAULT_HAIKU_MODEL` to your own deployment names, and choose a
specific model version when you create each deployment rather than
"auto-update to latest", so a model change is something you schedule.

Pin before you roll out to more than yourself. Retrofitting pins across a team
means every unpinned machine breaks on the day the default moves.

## Set It Up

In the [Foundry portal](https://ai.azure.com/), create a resource and note its
name, then create one deployment per Claude model and note each deployment name.

Each deployment also carries a **hosting option**, which decides whether
inference runs on Azure or on Anthropic infrastructure. If the reason you are on
Azure is a compliance boundary rather than billing convenience, this is the
setting that determines whether you actually got one. Choose it deliberately.

Two things block this that the portal does not tell you in advance.

**Pick the region for Claude, not for you.** Claude is offered in far fewer
regions than the rest of Foundry. `swedencentral` and `eastus2` carry the full
set; a handful of US regions carry a subset; most regions, including all of the
UK and the rest of Europe, carry none at all. The resource fixes the region, so
if data residency and Claude availability disagree, you find out after creating
the resource. Check first with
`az cognitiveservices model list --location <region>`.

**Quota starts at zero, and zero is not the same as exhausted.** Every Claude
model shows in the catalogue whether or not you can deploy it, because the catalogue
lists what the region offers while quota is granted per model, per subscription.
So the portal lets you fill in a deployment form and then fails on submit. Read
it with `az cognitiveservices usage list -l <region>`: `used 0, limit 0` means
nothing was ever granted, and no amount of deleting deployments frees any.

Two traps follow. An initial allocation comes from an Azure support ticket: the
quota-increase form raises an allocation that already exists, so it cannot create
one. And Claude on Foundry is an Azure Marketplace offer, which a Visual
Studio/MSDN, MPN, free-trial, student, or sponsored subscription cannot buy;
those sit at zero in every region permanently. Check
`az account show` against the subscription's `quotaId` before spending a day on
quota requests.

**Anthropic deployments need three extra fields.** A Claude deployment carries a
`modelProviderData` block (organisation name, industry, two-letter country code)
which signs the marketplace agreement behind it. The portal does not collect
all three, so portal deployments can fail with `InvalidModelProviderData`, and
`az cognitiveservices account deployment create` has no flag for it either
because the management SDK has no field for it. Creating one from a script means
a direct `PUT` to the management API. Budget for this if you are automating
onboarding; it is the step that surprises people.

Then set the environment:

```bash
export CLAUDE_CODE_USE_FOUNDRY=1
export ANTHROPIC_FOUNDRY_RESOURCE=your-resource
export ANTHROPIC_DEFAULT_OPUS_MODEL='<your-opus-deployment>'
export ANTHROPIC_DEFAULT_SONNET_MODEL='<your-sonnet-deployment>'
export ANTHROPIC_DEFAULT_HAIKU_MODEL='<your-haiku-deployment>'
```

`ANTHROPIC_FOUNDRY_BASE_URL` is the alternative to the resource name, for a
gateway or a non-standard endpoint. They are alternatives, not a pair: set one.

Confirm it with `/status` inside Claude Code: the API provider line reads
`Microsoft Foundry`.

Background work such as generating session titles uses the small, fast model. On
Foundry that defaults to your primary model, because not every account has a
Haiku deployment, which means title generation runs on Opus unless you pin
Haiku. Pin it.

## Authenticate

Three options, in the order Claude Code decides between them:

| Set                            | Use it for                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_FOUNDRY_AUTH_TOKEN` | A token some other process already obtained. Needs Claude Code 2.1.203+.                                       |
| `ANTHROPIC_FOUNDRY_API_KEY`    | Getting started, and anywhere Entra ID is not practical.                                                       |
| Neither                        | The Azure SDK default credential chain: `az login` on a laptop, a service principal or managed identity in CI. |

Prefer the credential chain over a key. A key is a long-lived secret that has to
live somewhere, and Azure's whole advantage here is that you do not need one:
`az login` on a developer machine and a managed identity in CI both give
credentials that rotate on their own. `Azure AI User` or
`Cognitive Services User` covers invoking a deployment; for tighter scoping,
grant `Microsoft.CognitiveServices/accounts/providers/*` as a custom role.

`/logout` inside Claude Code does nothing on Foundry. Authentication belongs to
Azure, so signing out means `az logout` or removing the key.

## Keep the Session Alive

The failure to design for is an expired Azure CLI login. It does not announce
itself: the token is simply gone, and the next request fails in a way that
looks like a Foundry problem rather than an auth problem.

Two things to know about checking for it:

- **Check the right audience.** `az account show` tells you an account is
  configured, not that a token can be minted for inference.
  `az account get-access-token --resource https://cognitiveservices.azure.com`
  is the check that matches what Claude Code actually needs.
- **The chain is not only the CLI.** A service principal or a managed identity
  sits beside `az` in the credential chain. Where one of those is configured, an
  unauthenticated `az` says nothing about whether requests will succeed, so a
  pre-flight that treats it as failure is wrong. Skip the check there instead of
  reporting a problem it cannot see.

[@lekman/claude-foundry](../../packages/claude-foundry/README.md) does both, plus
the configuration checks the missing wizard would have done, and hands the
environment to a single session so bare `claude` keeps whatever your global
settings say. Its `--setup` is the missing wizard: it reads the resource, the
catalogue, and the quota, creates the deployments the portal cannot, and writes the
env file so no deployment name is retyped. This is the same split as
[Bedrock](../bedrock/README.md#set-it-up-with-the-built-in-wizard): global
settings apply to every session, so mixing backends needs something that scopes
one of them to a single process.

For interactive versus headless, the reasoning is identical to Bedrock's:
`az login` completes in a browser, so it belongs on the session a human drives.
A headless subagent should inherit a credential rather than try to obtain one;
see [orchestrator and subagent](../orchestrator-subagent.md).

## Know What You Give Up

Foundry carries less of the Claude API than the first-party endpoint. Most of
what Claude Code itself uses is there but marked beta: extended and adaptive
thinking, effort, prompt caching, PDF input, structured outputs. Message
Batches, the Models API, and Managed Agents are absent, as are mid-conversation
system messages.

For a coding session that is fine. It matters when you are choosing one backend
for both Claude Code and an application you are building, because the
application is where those gaps bite. Check the feature table before assuming
one decision covers both.

Prompt caching is on by default. `ENABLE_PROMPT_CACHING_1H=1` asks for a
one-hour cache instead of the five-minute default; the longer TTL costs more per
cache write, so it pays off only when sessions have gaps longer than five
minutes.
