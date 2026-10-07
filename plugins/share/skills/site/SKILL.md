---
name: site
description: Put a site running on this machine, such as Storybook or a dev server, on the tailnet and give its address, so the operator can open it from a phone or another computer. Uses `tailscale serve`, so the site stays off the LAN and the internet. Use when the user says "/share:site 6006", "load this over tailscale", "make Storybook reachable on the tailnet", or "take port 6006 off tailscale".
user-invocable: true
---

# Site over Tailscale

Make a local site reachable at `http://<machine>.<tailnet>.ts.net:<port>/` for every device
on the operator's tailnet, and for nobody else.

The CLI is `bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts"`. In a clone of the toolkit it is
`bun plugins/share/scripts/share.ts`.

## How It Works

`tailscale serve` listens on this machine's tailnet address and passes each request to
`127.0.0.1:<port>`. The site itself listens on loopback only. So the tailnet is the only way
in: no router port, no LAN address, no public URL. The port number is the same on both sides.

## Step 1: Start the Site Bound to 127.0.0.1

If the site is already running, skip to Step 2. Otherwise start it in the background, bound
to loopback. Do not use `--host 0.0.0.0`: that also puts it on the LAN.

| Site                | Start command                                                |
| ------------------- | ------------------------------------------------------------ |
| Storybook           | `bunx storybook dev -p 6006 --host 127.0.0.1 --no-open --ci` |
| Vite                | `bunx vite --host 127.0.0.1 --port 5173`                     |
| Any folder of files | `python3 -m http.server 8000 --bind 127.0.0.1`               |

Run it with `run_in_background`, then wait until `curl -s http://127.0.0.1:<port>/` answers.

## Step 2: Put It on the Tailnet

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" expose <port>
```

It checks that something answers on `127.0.0.1:<port>`, runs `tailscale serve --bg`,
then fetches the tailnet address from this machine and prints it. It warns when the site
also listens on a wider address, and says how to fix that.

### When It Fails

These were seen on 7 Oct 2026 with Storybook 10.6 and Tailscale 1.102:

- **"Invalid host" (403) on the tailnet name.** Storybook bound to 127.0.0.1 accepts only
  host names it knows; `tailscale serve` passes the tailnet name through. `expose` detects
  this and exits 1 with the fix: add `.ts.net` to the server's allowed hosts and restart it.
  For Storybook that is `core: { allowedHosts: [".ts.net"] }` in `.storybook/main.ts`; for
  Vite it is `server.allowedHosts: [".ts.net"]`. That is a change in the project's repo, so
  say so in the report.
- **The site started on the next port.** When a port is already on the tailnet, Storybook's
  free-port check sees it as taken and starts on 6007 instead. To restart a site, run
  `unexpose <port>` first, start the site, check it is on the port you asked for, then
  `expose` again.
- **The tailnet IP gives 404.** `tailscale serve` routes by host name, so use the
  `.ts.net` address it prints, not the 100.x address.

## Step 3: Report

Give the address in a fenced block on its own, so it can be copied:

```text
http://server.tailnet.ts.net:6006/
```

Say what the site is, which port, and that it is reachable from the tailnet only.

## Taking It Down

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" exposed          # what is on the tailnet now
bun "${CLAUDE_PLUGIN_ROOT}/scripts/share.ts" unexpose <port>  # take one port off
```

`unexpose` leaves the local site running; stop the background process separately.

## Rules

- **Tailnet only.** Never use `tailscale funnel`, which publishes to the internet.
- **No patient or customer data.** A site that shows real records stays local.
- **`tailscale serve` settings outlive the session.** They are kept by the Tailscale daemon,
  so a port stays on the tailnet after the site stops (it then returns an error). Take ports
  off when the work is done.
