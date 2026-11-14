# Status

Check whether the services you depend on are in an outage, from each
provider's official status feed and from HTTP probes of your own endpoints.
One Bun script with no dependencies does the work, and the
[check](skills/check/SKILL.md) skill tells Claude when to run it: when you
ask, and when calls to a service keep failing with 5xx errors or timeouts.

```text
/plugin install status@ai-toolkit
/status:check
```

Example report:

```text
Service status at 2026-11-13 09:02 UTC

Microsoft 365     degraded     Users may be unable to connect to multiple Microsoft 365 services | We're seeing…
GitHub            ok           All Systems Operational
Google Workspace  ok           No open incidents

Microsoft 365 (degraded): https://status.cloud.microsoft/
  - Users may be unable to connect to multiple Microsoft 365 services [Service degradation], updated 2026-11-13T07:29:09+00:00

1 degraded of 3 services
```

## Run It Directly

```bash
bun plugins/status/scripts/cli.ts                 # every service
bun plugins/status/scripts/cli.ts --only github   # names containing a word
bun plugins/status/scripts/cli.ts --json          # JSON
bun plugins/status/scripts/cli.ts --list          # services and their feeds
```

| Exit | Means                                                    |
| ---- | -------------------------------------------------------- |
| 0    | Nothing affected (maintenance counts as unaffected)      |
| 1    | At least one service is degraded or in an outage         |
| 2    | Bad arguments or services file                           |
| 3    | Nothing affected, but at least one feed couldn't be read |
| 4    | This machine is offline: nothing answered at all         |

## Configure Your Services

Copy [services.example.json](services.example.json) to
`~/.config/status/services.json`, or point `$STATUS_CONFIG` at a file. Each
entry has a `name` and a `kind`:

| Kind               | Reads                                                       | Fields                                                                                               |
| ------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `statuspage`       | `<url>/api/v2/summary.json` on an Atlassian Statuspage site | `url`, and optional `components`: only these component names decide the level                        |
| `microsoft`        | `status.cloud.microsoft/api/posts/<feed>`                   | `feed`: `mac` (Microsoft 365 for business), `m365Consumer`, `azure` or `ppac`; optional `components` |
| `google-workspace` | The Google Workspace dashboard's `incidents.json`           | Optional `products`, such as `"Gmail"`                                                               |
| `aws`              | The AWS Health Dashboard's public current events            | Optional `regions`, such as `"eu-west-1"`, and `services`, such as `"ec2"`                           |
| `http`             | A GET to your own endpoint                                  | `url`, and optional `expect`: the status codes that mean up (default 200 to 399)                     |

Without `components`, a Statuspage site's overall indicator decides, so an
incident in a product you do not use still shows as degraded. Name the
components you depend on to avoid that. The names are on the status page, or
in `<url>/api/v2/summary.json`.

Many providers run Statuspage sites, for example GitHub
(`https://www.githubstatus.com`), Claude (`https://status.claude.com`),
Cloudflare (`https://www.cloudflarestatus.com`), Tailscale
(`https://status.tailscale.com`), Atlassian products such as Jira
(`https://jira-software.status.atlassian.com`), monday.com
(`https://status.monday.com`) and FreeAgent (`https://status.freeagent.com`).

Services that share a feed share one request, so listing several Microsoft
services costs one call.

## Your Own Connections

Home broadband and mobile networks rarely publish a status feed: their
checkers need an account login. When your own line is down, no feed answers,
so the script then asks Apple's and Google's connectivity pages too. If those
fail as well, it reports the machine as offline (exit 4) instead of a list of
unknown services, and prints the connections you list under `connections`:

```json
{
  "connections": [
    {
      "name": "Your broadband provider",
      "role": "broadband",
      "page": "https://isp.example/service-status",
      "phone": "0800 000 0000"
    },
    { "name": "Your mobile network", "role": "mobile" }
  ],
  "services": []
}
```

Only `name` is required. A phone line that reports outages is the most useful
field, because a phone on mobile data still works when the broadband is down.

## Levels

| Level         | From                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `ok`          | Operational, Available, no open incidents                                                              |
| `maintenance` | Scheduled maintenance in progress                                                                      |
| `degraded`    | Degraded performance, partial outage, a minor indicator, Microsoft's degradation and advisory states   |
| `outage`      | Major outage, a major or critical indicator, Microsoft's interruption states, an HTTP probe that fails |
| `unknown`     | The feed couldn't be read, or a named component is not in it                                           |

The AWS feed does not document its status codes. An ongoing regional
availability event carried `3` on 13 Nov 2026, so the script reads 3 as an
outage and 1 or 2 as degraded.

## Limits

- A status page can lag an outage by several minutes, and it says nothing
  about a fault in your own tenant or account. "ok" means no known outage.
- Crowd-report sites such as Downdetector are not a source. On 13 Nov 2026
  downdetector.com and downdetector.co.uk answered every request, robots.txt
  included, with a Cloudflare bot challenge (HTTP 403), and their terms forbid
  scraping.
- Read-only: the script only makes GET requests.

## Development

```bash
cd plugins/status
bun test
bun run typecheck
```

The tests read real feed responses captured on 13 Nov 2026, during a
Microsoft 365 outage, from `tests/fixtures/`.
