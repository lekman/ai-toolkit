# Security

Security settings for working with Claude, organised by **level**. Each level
protects a different blast radius and applies in different contexts — pick the
levels that match what you can afford to lose, not all of them by default.

- **[machine/](machine/README.md)** — workstation-level deny rules: stop the
  agent reading or clobbering secrets on the machine it runs on. Use it when the
  machine holds something worth losing.
- **[isolated/](isolated/README.md)** — repo-level guard rails for a disposable
  machine (remote / Docker / VM): the agent must ask a human before relaxing the
  commit checks or reconfiguring itself. Protects the repo, not the machine. Also
  holds an opt-in worktree write-guard for when several agents (or an agent and a
  human) share one checkout: it forces edits into isolated git worktrees.

More levels (CI, supply-chain) will be added as siblings.
