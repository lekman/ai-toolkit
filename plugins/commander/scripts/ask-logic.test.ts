import { describe, expect, it } from "bun:test";

import {
  accountOf,
  addressesOf,
  type AskContext,
  atlasAsk,
  CARD_TITLE,
  clientOf,
  convertedReason,
  deliveryOutput,
  idAddress,
  isCardOnly,
  messagesText,
  optedOut,
  parseAskArguments,
  questionsFrom,
  unseen,
  watchGoesOn,
  watchOn,
} from "./ask-logic.ts";

const context: AskContext = {
  account: "ultra-a",
  addresses: ["builder", "session-abcd1234"],
  clientId: "acme",
  config: {},
  host: "studio",
  sessionId: "abcd1234-0000",
  taskId: "01task",
};

describe("session addresses", () => {
  it("use a given name in the tasks server's form, then the id address", () => {
    expect(addressesOf("ABCD1234-ffff", { name: "Ops Portal" }, null)).toEqual([
      "ops-portal",
      "session-abcd1234",
    ]);
  });
  it("skip an automatic title, which changes as the session works", () => {
    expect(
      addressesOf(
        "abcd1234-ffff",
        { name: "fix(kpi): show one decimal", nameSource: "auto" },
        null,
      ),
    ).toEqual(["session-abcd1234"]);
  });
  it("fall back to the name on the claude command line", () => {
    expect(addressesOf("abcd1234", null, "Acme")).toEqual([
      "acme",
      "session-abcd1234",
    ]);
  });
  it("are built at once from a long run of hyphens", () => {
    const started = performance.now();
    expect(
      addressesOf("abcd1234", { name: "-".repeat(100_000) }, null),
    ).toEqual(["session-abcd1234"]);
    expect(performance.now() - started).toBeLessThan(100);
  });
  it("always have an id address", () => {
    expect(idAddress("")).toBe("session-unknown");
  });
});

describe("accounts", () => {
  it("name an account folder without .claude-, and ~/.claude as default", () => {
    expect(accountOf("/Users/x/.claude-ultra-b", "/Users/x")).toBe("ultra-b");
    expect(accountOf("/Users/x/.claude", "/Users/x")).toBe("default");
    expect(accountOf(undefined, "/Users/x")).toBe("default");
  });
});

describe("clients", () => {
  it("take the longest folder prefix, ask.json before the dashboard", () => {
    const config = { clients: { "/r/acme/inner": "Globex" } };
    const obsidian = {
      clients: { "/r/acme": "Acme Corp" },
      default_client: "Home Office",
    };
    expect(clientOf("/r/acme/inner/x", config, obsidian)).toBe("globex");
    expect(clientOf("/r/acme/other", config, obsidian)).toBe("acme-corp");
    expect(clientOf("/r/acmex", config, obsidian)).toBe("home-office");
    expect(clientOf("/elsewhere", {}, {})).toBeNull();
  });
  it("are card-only when ask.json lists them", () => {
    expect(isCardOnly({ ...context, config: { cardOnly: ["ACME"] } })).toBe(
      true,
    );
    expect(isCardOnly(context)).toBe(false);
  });
});

describe("the opt-out", () => {
  it("is ASK_HOOK=off, hook off in ask.json, or a name on the list", () => {
    expect(optedOut({ ASK_HOOK: "off" }, {}, ["builder"])).toBe(
      "ASK_HOOK is off",
    );
    expect(optedOut({}, { hook: "off" }, ["builder"])).not.toBeNull();
    expect(optedOut({}, { optOut: ["Build"] }, ["build-3"])).not.toBeNull();
    expect(optedOut({}, { optOut: ["Build"] }, ["builder"])).toBeNull();
    expect(optedOut({ ASK_HOOK: "on" }, {}, ["builder"])).toBeNull();
  });
  it("of the watcher is ASK_WATCH=off or watch false", () => {
    expect(watchOn({}, {})).toBe(true);
    expect(watchOn({ ASK_WATCH: "0" }, {})).toBe(false);
    expect(watchOn({}, { watch: false })).toBe(false);
  });
});

describe("questions from AskUserQuestion", () => {
  it("keep at most four questions and their options, cut to size", () => {
    const input = {
      questions: [
        {
          question: "Which region?",
          header: "Region",
          options: [{ label: "West", description: "Fast" }, { label: "" }],
          multiSelect: true,
          extra: "dropped",
        },
        { question: "" },
        ...Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}?` })),
      ],
    };
    const out = questionsFrom(input);
    expect(out[0]).toEqual({
      question: "Which region?",
      header: "Region",
      options: [{ label: "West", description: "Fast" }],
      multiSelect: true,
    });
    expect(out).toHaveLength(3);
    expect(questionsFrom(null)).toEqual([]);
  });
});

describe("what goes to Atlas", () => {
  it("is the questions, the session, the client and the task", () => {
    expect(
      atlasAsk(context, [{ question: "Which region?", options: [] }]),
    ).toEqual({
      session: {
        address: "builder",
        sessionId: "abcd1234-0000",
        account: "ultra-a",
        host: "studio",
      },
      clientId: "acme",
      taskId: "01task",
      questions: [{ question: "Which region?", options: [] }],
    });
  });
  it("is a card with a fixed title and a link, and no text, for a card-only client", () => {
    const card = atlasAsk(
      {
        ...context,
        config: {
          cardOnly: ["acme"],
          links: { acme: "https://tracker.example/task/{task}" },
        },
      },
      [{ question: "Secret plan?", options: [{ label: "Yes" }] }],
      "Secret title",
    );
    expect(card).toEqual({
      session: {
        address: "builder",
        sessionId: "abcd1234-0000",
        account: "ultra-a",
        host: "studio",
      },
      clientId: "acme",
      taskId: "01task",
      cardOnly: true,
      title: CARD_TITLE,
      questions: [],
      link: "https://tracker.example/task/01task",
    });
    expect(JSON.stringify(card)).not.toContain("Secret");
  });
});

describe("the refusal", () => {
  it("says it was automated, names the question and the skill, and says keep working", () => {
    const text = convertedReason("q-1", false, context, "/p/ask.ts");
    expect(text).toContain("Automated");
    expect(text).toContain("q-1");
    expect(text).toContain("commander:ask");
    expect(text).toContain("Keep working");
  });
  it("for a card, says where to write the question", () => {
    const text = convertedReason(
      "q-2",
      true,
      { ...context, config: { askIn: { acme: "in the ticket" } } },
      "/p/ask.ts",
    );
    expect(text).toContain("Write the question in the ticket");
    expect(text).toContain("no text");
  });
});

describe("delivery", () => {
  const message = (id: string, createdAt: string, deliveredAt?: string) => ({
    createdAt,
    from: "atlas:server",
    id,
    text: `text ${id}`,
    to: "builder",
    ...(deliveredAt ? { deliveredAt } : {}),
  });

  it("shows each message once, oldest first, and skips delivered ones", () => {
    const fresh = unseen(
      [
        message("b", "2026-03-12T09:02:00Z"),
        message("a", "2026-03-12T09:01:00Z"),
        message("a", "2026-03-12T09:01:00Z"),
        message("c", "2026-03-12T09:03:00Z"),
        message("d", "2026-03-12T09:04:00Z", "2026-03-12T09:05:00Z"),
      ],
      new Set(["c"]),
    );
    expect(fresh.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("writes the messages with their sender", () => {
    const text = messagesText(
      [message("a", "2026-03-12T09:01:00Z")],
      "builder",
    );
    expect(text).toContain("A message for this session (builder)");
    expect(text).toContain("From atlas:server, 2026-03-12T09:01:00Z:\ntext a");
  });

  it("blocks a stop, and adds context at a prompt or a start", () => {
    expect(deliveryOutput("Stop", "x")).toEqual({
      decision: "block",
      reason: "x",
    });
    expect(deliveryOutput("UserPromptSubmit", "x")).toEqual({
      hookSpecificOutput: {
        additionalContext: "x",
        hookEventName: "UserPromptSubmit",
      },
    });
    expect(deliveryOutput("PreToolUse", "x")).toBeNull();
  });

  it("keeps watching only while the session lives, the watcher owns it, and time is left", () => {
    const base = {
      deadline: 100,
      myPid: 7,
      now: 50,
      ownerPid: 7,
      sessionAlive: true,
    };
    expect(watchGoesOn(base)).toBe(true);
    expect(watchGoesOn({ ...base, ownerPid: 8 })).toBe(false);
    expect(watchGoesOn({ ...base, sessionAlive: false })).toBe(false);
    expect(watchGoesOn({ ...base, now: 100 })).toBe(false);
  });
});

describe("ask.ts arguments", () => {
  it("group options, headers and multi under the question before them", () => {
    expect(
      parseAskArguments([
        "--question",
        "Which region?",
        "--header",
        "Region",
        "--option",
        "West=Fast",
        "--option",
        "North",
        "--question",
        "Which checks?",
        "--multi",
        "--task",
        "01task",
      ]),
    ).toEqual({
      questions: [
        {
          question: "Which region?",
          header: "Region",
          options: [{ label: "West", description: "Fast" }, { label: "North" }],
        },
        { question: "Which checks?", options: [], multiSelect: true },
      ],
      taskId: "01task",
    });
  });
  it("refuse an option before any question, and a flag without a value", () => {
    expect(parseAskArguments(["--option", "x"])).toEqual({
      error: "--option comes after a --question",
    });
    expect(parseAskArguments(["--question"])).toEqual({
      error: "--question needs a value",
    });
  });
});
