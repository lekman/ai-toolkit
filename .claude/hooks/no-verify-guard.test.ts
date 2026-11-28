import { expect, test } from "bun:test";

import { blockMessage, findBypass } from "./no-verify-guard";

test("the refusal says what to do, the rule and its docs", () => {
  const message = blockMessage("`--no-verify` skips git hooks");
  expect(message).toContain("`--no-verify` skips git hooks");
  expect(message).toContain("Run the command without it");
  expect(message).toContain("Rule: no-hook-bypass");
  expect(message).toContain("Docs: docs/checks.md#no-hook-bypass");
});

test("blocks --no-verify on commit", () => {
  expect(findBypass("git commit --no-verify -m x")).toBeTruthy();
});
test("blocks --no-verify on push", () => {
  expect(findBypass("git push --no-verify")).toBeTruthy();
});
test("blocks git commit -n", () => {
  expect(findBypass("git commit -n -m x")).toBeTruthy();
});
test("blocks core.hooksPath override", () => {
  expect(findBypass("git -c core.hooksPath=/dev/null commit -m x")).toBeTruthy();
});
test("blocks a hook-skip env var", () => {
  expect(findBypass("HUSKY=0 git commit -m x")).toBeTruthy();
});
test("allows a normal commit", () => {
  expect(findBypass("git commit -m 'feat: add thing'")).toBeNull();
});
test("allows git push -n (dry-run, not a bypass)", () => {
  expect(findBypass("git push -n origin main")).toBeNull();
});
test("ignores -n inside a commit message", () => {
  expect(findBypass("git commit -m 'doc: explain the -n flag'")).toBeNull();
});
test("does not blame a chained push dry-run on the commit", () => {
  expect(findBypass("git commit -m x && git push -n")).toBeNull();
});
