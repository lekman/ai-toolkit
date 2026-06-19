# Security

Security settings for working with Claude, organised by **level**. Each level
protects a different blast radius and applies in different contexts — pick the
levels that match what you can afford to lose, not all of them by default.

- **[machine/](machine/)** — workstation-level deny rules: stop the agent
  reading or clobbering secrets on the machine it runs on.

More levels (repo, CI, supply-chain) will be added as siblings.
