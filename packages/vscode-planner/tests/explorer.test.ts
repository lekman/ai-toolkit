import { describe, expect, test } from "bun:test";

import { Explorer } from "../src/explorer/explorer.ts";

describe("Explorer.toggle", () => {
  test("shows hidden files and remembers which patterns were hiding", () => {
    const result = Explorer.toggle(
      { "**/.*": true, "**/*.log": true, "**/dist": false },
      [],
    );
    expect(result).toEqual({
      exclude: { "**/.*": false, "**/*.log": false, "**/dist": false },
      hidden: false,
      remembered: ["**/.*", "**/*.log"],
    });
  });

  test("hides again only the remembered patterns", () => {
    const result = Explorer.toggle(
      { "**/.*": false, "**/*.log": false, "**/dist": false },
      ["**/.*", "**/*.log"],
    );
    expect(result).toEqual({
      exclude: { "**/.*": true, "**/*.log": true, "**/dist": false },
      hidden: true,
      remembered: [],
    });
  });

  test("hides every false pattern when nothing is remembered", () => {
    expect(Explorer.toggle({ a: false, b: false }, ["gone"]).exclude).toEqual({
      a: true,
      b: true,
    });
  });

  test("leaves conditional patterns alone", () => {
    const when = { when: "$(basename).ts" };
    expect(Explorer.toggle({ a: true, b: when }, []).exclude).toEqual({
      a: false,
      b: when,
    });
  });

  test("does nothing with an empty list", () => {
    expect(Explorer.toggle({}, [])).toEqual({
      exclude: {},
      hidden: false,
      remembered: [],
    });
  });
});
