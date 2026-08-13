import { describe, expect, test } from "bun:test";

import { Config } from "../src/config";

describe("Config", () => {
  test("build derives data dir under storage and sane defaults", () => {
    const config = Config.build("/vault", "/home/user/.rag");
    expect(config.dataDir).toBe("/home/user/.rag/data");
    expect(config.freshnessDays).toBe(30);
  });

  test("validate accepts a built config", () => {
    expect(Config.validate(Config.build("/vault", "/s"))).toEqual([]);
  });

  test.each([
    [null, ["config is not an object"]],
    [
      { dataDir: "", freshnessDays: 30, storageDir: "/s", vaultPath: "/v" },
      ["dataDir missing or empty"],
    ],
    [
      {
        dataDir: "relative/path",
        freshnessDays: 30,
        storageDir: "/s",
        vaultPath: "/v",
      },
      ["dataDir must be an absolute path"],
    ],
    [
      { dataDir: "/d", freshnessDays: 0, storageDir: "/s", vaultPath: "/v" },
      ["freshnessDays must be a positive number"],
    ],
  ])("validate rejects %j", (candidate, problems) => {
    expect(Config.validate(candidate)).toEqual(problems);
  });
});
