import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every check in this repository ends its failure message with a rule name
// and a link into docs/checks.md. These tests keep the two in step: a message
// cannot point at a section that does not exist, and a section cannot outlive
// the check it documents.
const ROOT = join(import.meta.dir, "..");
const SOURCES = [
  ".claude/hooks/no-verify-guard.ts",
  ".github/workflows/client-content.yml",
  ".github/workflows/dependabot-lockfile.yml",
  "scripts/breadcrumbs.ts",
  "scripts/check-no-client-content.sh",
  "scripts/hooks.ts",
];

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

/** Rule names that have a section in docs/checks.md. */
const documented = new Set(
  [...read("docs/checks.md").matchAll(/^## `([a-z-]+)`$/gm)].map(
    (m) => m[1] as string,
  ),
);

/** Rule names each source file links to. */
const linked = new Map<string, string[]>(
  SOURCES.map((path) => [
    path,
    [...read(path).matchAll(/Docs: docs\/checks\.md#([a-z-]+)/g)].map(
      (m) => m[1] as string,
    ),
  ]),
);

test("every check source links to at least one rule", () => {
  for (const [path, rules] of linked) {
    expect(
      rules.length,
      `${path} has no "Docs: docs/checks.md#..." link`,
    ).toBeGreaterThan(0);
  }
});

test("every linked rule has a section in docs/checks.md", () => {
  for (const [path, rules] of linked) {
    for (const rule of rules) {
      expect(
        documented.has(rule),
        `${path} links to a missing rule: ${rule}`,
      ).toBe(true);
    }
  }
});

test("every link sits beside the same rule name", () => {
  // A message prints "Rule: <name>" and then, within a line or two, the link.
  // Matching them as a pair catches two messages whose links were swapped,
  // which a search of the whole file for each name would let through.
  const pair = /Rule: ([a-z-]+)[^]{0,40}?Docs: docs\/checks\.md#([a-z-]+)/g;
  for (const [path, rules] of linked) {
    const pairs = [...read(path).matchAll(pair)];
    expect(pairs.length, `${path} has a link with no rule name beside it`).toBe(
      rules.length,
    );
    for (const [, named, linkedTo] of pairs) {
      expect(linkedTo, `${path} names ${named} and links elsewhere`).toBe(
        named as string,
      );
    }
  }
});

test("every section in docs/checks.md is linked from a check", () => {
  const used = new Set([...linked.values()].flat());
  for (const rule of documented) {
    expect(used.has(rule), `no check links to the rule: ${rule}`).toBe(true);
  }
});
