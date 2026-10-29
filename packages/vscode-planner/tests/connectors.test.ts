import { describe, expect, test } from "bun:test";

import { Connectors } from "../src/connectors/connectors.ts";

/** The request for a call, failing the test when there is none. */
function request(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  offset = 60,
) {
  const r = Connectors.request(server, tool, args, offset);
  if (!r) throw new Error(`no request for ${server}/${tool}`);
  return r;
}

describe("connector", () => {
  test("maps the page's server names to settings names", () => {
    expect(Connectors.connector("GitHub")).toBe("github");
    expect(Connectors.connector("Microsoft 365")).toBe("microsoft365");
    expect(Connectors.connector("monday.com")).toBe("monday");
    expect(Connectors.connector("Google Calendar")).toBeNull();
  });

  test("covers only the tools the page calls", () => {
    expect(Connectors.request("GitHub", "create_issue", {}, 0)).toBeNull();
    expect(Connectors.request("GitHub", "list_issues", {}, 0)).toBeNull();
  });
});

describe("GitHub", () => {
  const args = { owner: "acme", perPage: 100, repo: "web", state: "OPEN" };

  test("searches the repository's open issues, newest update first", () => {
    const r = request("GitHub", "list_issues", args);
    const url = new URL(r.url);
    expect(url.pathname).toBe("/search/issues");
    expect(url.searchParams.get("q")).toBe("repo:acme/web is:issue is:open");
    expect(url.searchParams.get("sort")).toBe("updated");
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(r.credential).toBe("github");
  });

  test("answers in the connector's shape, without pull requests", () => {
    const result = request("GitHub", "list_issues", args).result({
      items: [
        {
          assignees: [{ login: "ann" }],
          labels: [{ name: "bug" }],
          number: 7,
          title: "Broken",
          updated_at: "2026-10-27T09:00:00Z",
        },
        { number: 8, pull_request: {}, title: "A PR" },
      ],
      total_count: 3,
    }) as { payload: unknown };
    expect(result.payload).toEqual({
      issues: [
        {
          assignees: ["ann"],
          labels: ["bug"],
          number: 7,
          title: "Broken",
          updated_at: "2026-10-27T09:00:00Z",
        },
      ],
      pageInfo: { hasNextPage: true },
      totalCount: 3,
    });
  });

  test("get_me answers with the login", () => {
    const result = request("GitHub", "get_me", {}).result({
      id: 1,
      login: "ann",
    });
    expect((result as { payload: unknown }).payload).toEqual({ login: "ann" });
  });
});

describe("Microsoft 365", () => {
  const args = {
    afterDateTime: "2026-10-27",
    beforeDateTime: "2026-11-03",
    limit: 25,
    query: "*",
  };

  test("reads the calendar view between local midnights, in UTC", () => {
    const r = request("Microsoft 365", "outlook_calendar_search", args);
    expect(r.url).toContain("/me/calendarView?$orderby=start%2FdateTime");
    expect(r.url).toContain("startDateTime=2026-10-27T00%3A00%3A00%2B01%3A00");
    expect(r.url).toContain("endDateTime=2026-11-03T00%3A00%3A00%2B01%3A00");
    expect(r.url).toContain("$top=25");
    expect(r.headers.prefer).toBe('outlook.timezone="UTC"');
    expect(
      request("Microsoft 365", "outlook_calendar_search", args, -330).url,
    ).toContain("2026-10-27T00%3A00%3A00-05%3A30");
  });

  test("answers with one JSON text block per event", () => {
    const event = {
      id: "e1",
      start: { dateTime: "2026-10-27T12:00:00", timeZone: "UTC" },
      subject: "Sync",
    };
    const result = request(
      "Microsoft 365",
      "outlook_calendar_search",
      args,
    ).result({ value: [event] }) as {
      content: { text: string }[];
    };
    expect(result.content.map((c) => JSON.parse(c.text))).toEqual([event]);
  });

  test("needs both dates", () => {
    expect(
      Connectors.request(
        "Microsoft 365",
        "outlook_calendar_search",
        { afterDateTime: "x" },
        0,
      ),
    ).toBeNull();
  });
});

describe("monday.com", () => {
  const args = {
    boardId: 123,
    columnIds: ["status", "prio"],
    filters: [
      { columnId: "people", compareValue: ["person-9"], operator: "any_of" },
    ],
    includeColumns: true,
    limit: 100,
  };

  test("sends the page's filters as items_page rules", () => {
    const r = request("monday.com", "get_board_items_page", args);
    const body = JSON.parse(r.body!) as { variables: unknown };
    expect(body.variables).toEqual({
      board: ["123"],
      columns: ["status", "prio"],
      limit: 100,
      rules: [
        {
          column_id: "people",
          compare_value: ["person-9"],
          operator: "any_of",
        },
      ],
    });
    expect(r.method).toBe("POST");
    expect(Connectors.authorization("monday", "t")).toBe("t");
  });

  test("answers with column values as a map", () => {
    const result = request("monday.com", "get_board_items_page", args).result({
      data: {
        boards: [
          {
            items_page: {
              cursor: "next",
              items: [
                {
                  column_values: [
                    { id: "status", text: "Working on it" },
                    { id: "prio", text: null },
                  ],
                  group: { title: "Sprint" },
                  id: "1",
                  name: "Item",
                  updated_at: "2026-10-27T09:00:00Z",
                  url: "https://x.monday.com/boards/123/pulses/1",
                },
              ],
            },
          },
        ],
      },
    }) as { payload: unknown };
    expect(result.payload).toEqual({
      items: [
        {
          column_values: { prio: null, status: "Working on it" },
          group: { title: "Sprint" },
          id: "1",
          name: "Item",
          updated_at: "2026-10-27T09:00:00Z",
          url: "https://x.monday.com/boards/123/pulses/1",
        },
      ],
      pagination: { has_more: true },
    });
  });

  test("fails on a GraphQL error", () => {
    expect(() =>
      request("monday.com", "get_board_items_page", args).result({
        errors: [{ message: "bad column" }],
      }),
    ).toThrow();
  });
});

describe("errors", () => {
  test("a refused credential asks for a new sign-in", () => {
    expect(Connectors.failure("github", 401, "Bad credentials")).toMatchObject({
      code: "needs_reauth",
    });
    expect(Connectors.failure("monday", 500, "oops")).toMatchObject({
      code: "upstream_error",
    });
    expect(Connectors.missing("monday")).toEqual({
      code: "not_granted",
      message: "Run Atlas: Set monday.com Token.",
    });
  });

  test("only monday.com takes the token bare", () => {
    expect(Connectors.authorization("github", "t")).toBe("Bearer t");
    expect(Connectors.authorization("microsoft", "t")).toBe("Bearer t");
  });
});
