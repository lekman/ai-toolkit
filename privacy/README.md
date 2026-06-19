# Privacy

**Practice:** keep sensitive data — PII, PHI, financial — from reaching the AI
agent or being transmitted to the model or any third party.

Where [security/](../security/README.md) protects the *system*, privacy protects
**data subjects**: customers, patients, and you. If it fails, the people harmed
are not (only) you — they are the people whose data you hold, plus your own
exposure under GDPR, HIPAA, or PCI. Treat the agent and the model as data
processors and decide, deliberately, what they are allowed to see.

## What makes this different from security

The threat surface is wider than files. Sensitive data leaks through:

- **Files** — datasets, exports, logs, fixtures committed or read.
- **The prompt itself** — what you (or a tool) paste into the agent.
- **The model call** — what the agent transmits upstream to get its answer.

Security's file and shell denies do not cover the last two. Privacy has to act
on input and on what leaves, not just on what sits in the repo.

## Shift left, but own the outcome

Same stance as the commit hooks: catch leaks early and cheaply, but the hook is
not where responsibility lives. Scan and redact before data lands — in commits
*and* in prompts — and still assert the same at the repo and in review. It is
the data owner's job to ensure nothing sensitive is disclosed.

## Techniques

Documented as they are added (this is the shape, not yet the implementation):

- **PII / PHI scanning** — detect identifiers before they are committed or sent.
- **Redaction** — strip or mask matched data rather than block outright.
- **Data minimization** — give the agent the least it needs, not the dataset.
- **Allowlisting** — a reviewed list of accepted matches so scanning stays
  usable instead of noisy.

## Relationship to security

Siblings, not parent and child. Both shift left, both lean on scanning and on
`deny` / `ask` permissions and hooks. They differ in *who* they protect:
security the system, privacy the data subjects. Cross-reference, do not nest.
