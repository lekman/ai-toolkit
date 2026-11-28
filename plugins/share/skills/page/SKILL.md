---
name: page
description: Share a Markdown document, such as a plan, a decision record or a report, as a web page the operator can read on any device on the tailnet, and give its link. The page also shows on the share home page with the services and file shares. Use when the user says "/share:page <file>", "share this plan", "serve the plan over tailscale", "give me a link to read this on my phone", or whenever a document is written for the operator to read.
user-invocable: true
---

# Share a Page

Render a Markdown file to a page on this machine's share site and give the operator its link.
Pages stay until they are removed, unlike file shares, which expire.

The CLI is `bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts"`. In a clone of the toolkit it is
`bun plugins/share/scripts/share.ts`.

## Step 1: Share It

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" page "<file.md>" [--slug "<short name>"]
```

It renders the file (front matter is left out; `status:` is shown), records which session
shared it and when, makes sure the site is up and on the tailnet, and prints the page's link
and the home page's link. The slug defaults to the file name; give `--slug` when the file name
is long or not unique.

**A page is a copy.** After editing the source, run `page` again with the same file (and the
same `--slug`, if one was given) so the link shows the new text.

## Step 2: Report

Give the link printed by the script, in a fenced block on its own:

```text
https://server.example.com/plans/questions-plan.html
```

When the share folder's `config.json` sets `publicBase` (an easy address that redirects to
this machine's tailnet address), the links use it; use those links, not the `.ts.net`
address and never a local file path.

## Removing a Page

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" unpage <slug>
```

## Rules

- **Tailnet only.** The site is reachable from the operator's tailnet and nowhere else, even
  when an easy public address redirects to it.
- **No secrets, tokens, patient or customer data** on a page. A page about such work says
  where the data lives instead.
