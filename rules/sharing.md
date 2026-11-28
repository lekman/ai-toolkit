# Sharing Work With the Operator

When something is made for the operator to read or open, share it with the `share` plugin
and give its link. Never hand over a local file path alone; the operator is often on another
device.

- **A document** (a plan, a decision record, a report): `/share:page <file.md>`. Give the
  page link it prints. A page is a copy, so share the file again after each edit.
- **A running site** (Storybook, a dev server, a dashboard): `/share:site <port>` with
  `--name`, so it shows as a named card on the share home page. A site is not done until it
  is listed there.
- **Temporary files** (screenshots, exports, a built folder): `/share:files <paths>`.
- **Links.** Use exactly the links the skills print. When the share folder's `config.json`
  sets `publicBase`, they use that easy address; do not rewrite them to the `.ts.net` address,
  and do not invent paths.
- **When asked what is shared**, give the home page link (`share.ts home`).
- **Tailnet only.** Never use `tailscale funnel`. No secrets, tokens, patient or customer data
  on a shared page, site or file.
- **Clean up.** Take a site off the tailnet (`unexpose <port>`) when its work is done, and
  remove pages that are no longer current (`unpage <slug>`).
