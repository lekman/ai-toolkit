# ai-toolkit

> My practices, tools, and workflows for working with Anthropic Claude

## Why This Exists

[Defence in depth for agents](https://www.lekman.com/blog/ai-security-defence-in-depth-for-agents)
sets out the reasoning: an agent is an eager developer, so the question is never
whether you trust it, but what the blast radius is when it gets something wrong.
That post is the argument. This repo is the working configuration behind it.

Two questions decide the blast radius, and they are independent.

**What can the agent reach?** This decides what a mistake, or an injected
prompt, can actually do. It is the question the post covers.

| Layer in the post  | What answers it here                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| A separate context | [@lekman/claude-docker](packages/claude-docker/README.md): a container holding one repo, one branch, and nothing else of yours          |
| Dedicated accounts | The same package: it clones with a second account's key, mounts it read-only, and never forwards your SSH agent                         |
| Scoped credentials | [Machine security](security/machine/README.md) for the workstation, [isolated-agent security](security/isolated/README.md) for the repo |

**Where does inference run?** This decides what data leaves your control. The
post does not cover it.

| If the requirement is                 | Use                                                         |
| ------------------------------------- | ----------------------------------------------------------- |
| Nothing leaves the machine            | [@lekman/claude-local](packages/claude-local/README.md)     |
| Your own AWS account and region       | [@lekman/claude-bedrock](packages/claude-bedrock/README.md) |
| Your own Azure tenant, under Entra ID | [@lekman/claude-foundry](packages/claude-foundry/README.md) |

Confusing the two is the usual mistake. Running Claude in your own AWS account
answers the second question and nothing about the first: the agent still has
your laptop. Putting it in a container answers the first and nothing about the
second. Most setups need both.

How strong each control actually is, and what has to fail for it to fail, is
[controls: soft, hard, boundary](docs/controls.md). Read that before trusting
any of the above further than it goes.

## Start Here

- **[Standards](standards/README.md)**: make Claude behave consistently across
  every project.
- **[Machine security](security/machine/README.md)**: stop the agent reading or
  using secrets on the machine it runs on.

## Build on It

- **[Privacy](privacy/README.md)**: keep PII, PHI, and financial data away from
  the agent and the model.
- **[Observability](observability/README.md)**: see what the agent is doing and
  get notified when it needs you.
- **[Isolated-agent security](security/isolated/README.md)**: guard rails for a remote or Docker-based agent.
- **[Practices](practices/README.md)**: operating models and patterns.
- **[Skills](plugins/README.md)**: reusable workflows for common tasks.
- **[Repo guards](scripts/README.md)**: a pre-commit hook that keeps client
  names, ticket keys and internal system names out of a public repo written
  during client work.

## Build with It

- **[@lekman/claude-local](packages/claude-local/README.md)** run fully private, offline and uncensored LLMs on your local machine.
- **[@lekman/claude-bedrock](packages/claude-bedrock/README.md)** run Claude in your own AWS account and region, under your own IAM, without prompts reaching Anthropic's own API.
- **[@lekman/claude-foundry](packages/claude-foundry/README.md)** run Claude on Azure under Entra ID and RBAC; each deployment's hosting option decides whether inference stays on Azure.
- **[@lekman/claude-docker](packages/claude-docker/README.md)** run an agent with permissions bypassed inside a container that holds one repo, one branch, and one dedicated key, and nothing else of yours.
