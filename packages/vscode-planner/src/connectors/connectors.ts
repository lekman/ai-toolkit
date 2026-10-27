/**
 * Connector tool calls, answered by the services' own APIs.
 *
 * The Atlas page calls claude.ai connectors by name: `GitHub`,
 * `Microsoft 365` and `monday.com`. VS Code cannot reach those connectors,
 * so each call the page makes is turned into one API request here, and the
 * API's answer is shaped like the connector's, so the page needs no change.
 * Only the tools the page calls are covered.
 *
 * A result carries the data twice, as the connectors do: as `payload`, and
 * as JSON text in `content`.
 */

import type { RuntimeError } from "../atlas/index.ts";
import type { ConnectorName, ConnectorRequest, Credential } from "./types.ts";

const GITHUB = "https://api.github.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
const MONDAY = "https://api.monday.com/v2";

const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
};

const MONDAY_QUERY = `query ($board: [ID!], $limit: Int!, $rules: [ItemsQueryRule!], $columns: [String!]) {
  boards(ids: $board) {
    items_page(limit: $limit, query_params: { rules: $rules }) {
      cursor
      items { id name url updated_at group { title } column_values(ids: $columns) { id text } }
    }
  }
}`;

/** Which setting name covers which connector the page calls. */
const SERVERS: Record<string, ConnectorName> = {
  GitHub: "github",
  "Microsoft 365": "microsoft365",
  "monday.com": "monday",
};

/** What each connector needs before it works, for the page's error text. */
const SETUP: Record<ConnectorName, string> = {
  github: "Sign in with `gh auth login`.",
  microsoft365:
    "Sign in with the calendar package: `bun src/auth.ts start`, then `finish`.",
  monday: "Run Atlas: Set monday.com Token.",
};

/** Builds API requests for connector calls and shapes their answers. */
export class Connectors {
  /**
   * The authorization header value for a credential. monday.com takes the
   * token bare; GitHub and Microsoft Graph take it as a bearer token.
   *
   * @param credential - Which credential.
   * @param token - The token.
   * @returns The header value.
   */
  static authorization(credential: Credential, token: string): string {
    return credential === "monday" ? token : `Bearer ${token}`;
  }

  /**
   * The connector a server name belongs to.
   *
   * @param server - The name the page used.
   * @returns The connector, or null for one with no direct version.
   */
  static connector(server: string): ConnectorName | null {
    return SERVERS[server] ?? null;
  }

  /**
   * The error for an API answer that is not a success.
   *
   * A refused credential becomes `needs_reauth`, which the page treats as a
   * connector to sign in to again, so the section empties rather than
   * showing stale data.
   *
   * @param name - The connector.
   * @param status - The HTTP status.
   * @param detail - The response body or error text.
   * @returns The error to answer the page with.
   */
  static failure(
    name: ConnectorName,
    status: number,
    detail: string,
  ): RuntimeError {
    const message = `${name}: HTTP ${status}. ${detail.slice(0, 200)}`.trim();
    return status === 401 || status === 403
      ? { code: "needs_reauth", message: `${message} ${SETUP[name]}` }
      : { code: "upstream_error", message };
  }

  /**
   * The error for a connector with no credential on this machine.
   *
   * @param name - The connector.
   * @returns `not_granted`, with what to do about it.
   */
  static missing(name: ConnectorName): RuntimeError {
    return { code: "not_granted", message: SETUP[name] };
  }

  /**
   * The request that answers one connector call.
   *
   * @param server - The connector name the page used.
   * @param tool - The tool name.
   * @param args - The tool's arguments, as the page sent them.
   * @param utcOffsetMinutes - This machine's offset from UTC, so calendar
   * dates are read as local days, as the page means them.
   * @returns The request, or null when the call is not covered.
   */
  static request(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    utcOffsetMinutes: number,
  ): ConnectorRequest | null {
    switch (`${server}/${tool}`) {
      case "GitHub/get_me":
        return {
          credential: "github",
          headers: GITHUB_HEADERS,
          method: "GET",
          result: (json) => Connectors.wrap({ login: field(json, "login") }),
          url: `${GITHUB}/user`,
        };
      case "GitHub/list_issues":
        return Connectors.githubIssues(args);
      case "Microsoft 365/outlook_calendar_search":
        return Connectors.outlookEvents(args, utcOffsetMinutes);
      case "monday.com/get_board_items_page":
        return Connectors.mondayItems(args);
      default:
        return null;
    }
  }

  /**
   * Open issues in one repository, most recently updated first.
   *
   * The search API is used, not the issues list, because it gives the total
   * the page shows and leaves pull requests out.
   *
   * @param args - `owner`, `repo`, `perPage`.
   * @returns The request, or null without an owner and repository.
   */
  private static githubIssues(
    args: Record<string, unknown>,
  ): ConnectorRequest | null {
    const owner = text(args.owner);
    const repo = text(args.repo);
    if (!owner || !repo) return null;
    const perPage = Math.min(100, Math.max(1, number(args.perPage) ?? 30));
    const q = `repo:${owner}/${repo} is:issue is:open`;
    return {
      credential: "github",
      headers: GITHUB_HEADERS,
      method: "GET",
      result: (json) => {
        const items = list(json, "items").filter((i) => !("pull_request" in i));
        const total = number(field(json, "total_count")) ?? items.length;
        return Connectors.wrap({
          issues: items.map((i) => ({
            assignees: list(i, "assignees").map((a) => field(a, "login")),
            labels: list(i, "labels").map((l) => field(l, "name")),
            number: i.number,
            title: i.title,
            updated_at: i.updated_at,
          })),
          pageInfo: { hasNextPage: total > items.length },
          totalCount: total,
        });
      },
      url: `${GITHUB}/search/issues?${new URLSearchParams({
        order: "desc",
        per_page: String(perPage),
        q,
        sort: "updated",
      })}`,
    };
  }

  /**
   * The items on a monday.com board that match the page's filters.
   *
   * The connector takes filters as `{ columnId, compareValue, operator }`
   * and returns `column_values` as a map from column id to its text, so
   * both are translated.
   *
   * @param args - `boardId`, `limit`, `columnIds`, `filters`.
   * @returns The request, or null without a board.
   */
  private static mondayItems(
    args: Record<string, unknown>,
  ): ConnectorRequest | null {
    const board = args.boardId;
    if (typeof board !== "number" && typeof board !== "string") return null;
    const rules = (Array.isArray(args.filters) ? args.filters : [])
      .filter(isRecord)
      .map((f) => ({
        column_id: f.columnId,
        compare_value: f.compareValue,
        operator: f.operator,
      }));
    const columns = Array.isArray(args.columnIds)
      ? args.columnIds.filter((c) => typeof c === "string")
      : null;
    return {
      body: JSON.stringify({
        query: MONDAY_QUERY,
        variables: {
          board: [String(board)],
          columns,
          limit: Math.min(500, Math.max(1, number(args.limit) ?? 100)),
          rules,
        },
      }),
      credential: "monday",
      headers: { "api-version": "2025-04", "content-type": "application/json" },
      method: "POST",
      result: (json) => {
        const errors = list(json, "errors");
        if (errors.length) {
          throw {
            code: "upstream_error",
            message: String(field(errors[0], "message") ?? "monday.com error"),
          };
        }
        const page = field(
          list(field(json, "data"), "boards")[0],
          "items_page",
        );
        return Connectors.wrap({
          items: list(page, "items").map((i) => ({
            column_values: Object.fromEntries(
              list(i, "column_values").map((c) => [c.id, c.text ?? null]),
            ),
            group: i.group,
            id: i.id,
            name: i.name,
            updated_at: i.updated_at,
            url: i.url,
          })),
          pagination: { has_more: Boolean(field(page, "cursor")) },
        });
      },
      url: MONDAY,
    };
  }

  /**
   * Events in the default calendar between two dates.
   *
   * The connector answers with one JSON text block per event, in the shape
   * Microsoft Graph uses, so Graph's own events are passed through. Times
   * come back in UTC, which the page reads as such.
   *
   * @param args - `afterDateTime` and `beforeDateTime` as `YYYY-MM-DD`, `limit`.
   * @param utcOffsetMinutes - This machine's offset from UTC.
   * @returns The request, or null without both dates.
   */
  private static outlookEvents(
    args: Record<string, unknown>,
    utcOffsetMinutes: number,
  ): ConnectorRequest | null {
    const after = date(args.afterDateTime);
    const before = date(args.beforeDateTime);
    if (!after || !before) return null;
    const offset = formatOffset(utcOffsetMinutes);
    return {
      credential: "microsoft",
      headers: { prefer: 'outlook.timezone="UTC"' },
      method: "GET",
      result: (json) => {
        const events = list(json, "value");
        return {
          content: events.map((e) => ({
            text: JSON.stringify(e),
            type: "text",
          })),
          payload: { value: events },
        };
      },
      // Graph wants the `$` of its query options as written, so the query
      // string is built by hand rather than with URLSearchParams.
      url: `${GRAPH}/me/calendarView?${query({
        $orderby: "start/dateTime",
        $select:
          "id,subject,start,end,isAllDay,isCancelled,webLink,location,attendees",
        $top: String(Math.min(100, Math.max(1, number(args.limit) ?? 25))),
        endDateTime: `${before}T00:00:00${offset}`,
        startDateTime: `${after}T00:00:00${offset}`,
      })}`,
    };
  }

  private static wrap(payload: unknown): unknown {
    return {
      content: [{ text: JSON.stringify(payload), type: "text" }],
      payload,
    };
  }
}

function date(value: unknown): null | string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** `+01:00` for 60 minutes east of UTC. */
function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown, key: string): Record<string, unknown>[] {
  const items = field(value, key);
  return Array.isArray(items) ? items.filter(isRecord) : [];
}

function number(value: unknown): null | number {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function query(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

function text(value: unknown): null | string {
  return typeof value === "string" && value ? value : null;
}
