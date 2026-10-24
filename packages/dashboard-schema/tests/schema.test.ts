import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const schema = JSON.parse(
  readFileSync(join(root, "schema/dashboard-item.schema.json"), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, "examples", name), "utf8"));
}

describe("examples", () => {
  for (const name of readdirSync(join(root, "examples"))) {
    test(`${name} is valid`, () => {
      const ok = validate(load(name));
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    });
  }
});

describe("rules", () => {
  test("a blocked item without details is valid: details are optional on import", () => {
    const item = load("blocked-integration.json");
    delete item.blockedOn;
    expect(validate(item)).toBe(true);
  });

  test("blockedOn on an item that is not blocked is refused", () => {
    const item = load("quick-win.json");
    item.blockedOn = { since: "2026-10-24", waitingFor: "someone" };
    expect(validate(item)).toBe(false);
  });

  test("doneOn on an item that is not done is refused", () => {
    const item = load("quick-win.json");
    item.doneOn = "2026-10-24";
    expect(validate(item)).toBe(false);
  });

  test("a log note over 160 characters is refused", () => {
    const item = load("blocked-integration.json");
    (item.log as { note: string }[])[0]!.note = "x".repeat(161);
    expect(validate(item)).toBe(false);
  });

  test("a summary over 2000 characters is refused", () => {
    const item = load("quick-win.json");
    item.summary = "x".repeat(2001);
    expect(validate(item)).toBe(false);
  });

  test("priority is required: it is the fallback until the item is sized", () => {
    const item = load("quick-win.json");
    delete item.priority;
    expect(validate(item)).toBe(false);
  });

  test("an id that is not lower-case words and hyphens is refused", () => {
    const item = load("quick-win.json");
    item.id = "01JB90A1B2C3D4E5F6G7H8J9KM";
    expect(validate(item)).toBe(false);
  });

  test("an unknown business value is refused", () => {
    const item = load("quick-win.json");
    item.businessValue = "huge";
    expect(validate(item)).toBe(false);
  });
});
