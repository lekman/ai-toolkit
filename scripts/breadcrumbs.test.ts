import { expect, test } from "bun:test";

import { ancestors, apply, inScope, parentOf, render } from "./breadcrumbs";

const PAGES = new Set([
  "README.md",
  "practices/README.md",
  "practices/engineering/README.md",
  "practices/engineering/code-review.md",
  "practices/orchestrator-subagent.md",
  "practices/no-readme/deep/page.md",
]);
const exists = (path: string): boolean => PAGES.has(path);
const TITLES: Record<string, string> = {
  "practices/engineering/README.md": "Engineering with Agents",
  "practices/README.md": "Practices",
  "README.md": "ai-toolkit",
};
const title = (path: string): string => TITLES[path] ?? "";

test("the front page has no parent", () => {
  expect(parentOf("README.md", exists)).toBeNull();
});

test("a page's parent is the README beside it", () => {
  expect(parentOf("practices/engineering/code-review.md", exists)).toBe(
    "practices/engineering/README.md",
  );
});

test("a README's parent is the README one folder up", () => {
  expect(parentOf("practices/engineering/README.md", exists)).toBe(
    "practices/README.md",
  );
  expect(parentOf("practices/README.md", exists)).toBe("README.md");
});

test("a folder with no README is skipped on the way up", () => {
  expect(parentOf("practices/no-readme/deep/page.md", exists)).toBe(
    "practices/README.md",
  );
});

test("ancestors run from the front page down to the parent", () => {
  expect(ancestors("practices/engineering/code-review.md", exists)).toEqual([
    "README.md",
    "practices/README.md",
    "practices/engineering/README.md",
  ]);
});

test("each link is relative to the page and named by its target's title", () => {
  const path = "practices/engineering/code-review.md";
  expect(render(path, ancestors(path, exists), title)).toBe(
    "[ai-toolkit](../../README.md) / [Practices](../README.md) / [Engineering with Agents](README.md)",
  );
});

test("the breadcrumb goes under the title", () => {
  expect(apply("# Page\n\nText.\n", "[ai-toolkit](README.md)")).toBe(
    "# Page\n\n[ai-toolkit](README.md)\n\nText.\n",
  );
});

test("an earlier breadcrumb is replaced, so a second run changes nothing", () => {
  const once = apply("# Page\n\nText.\n", "[ai-toolkit](../README.md)");
  expect(apply(once, "[ai-toolkit](../README.md)")).toBe(once);
  expect(apply(once, "[ai-toolkit](../../README.md) / [Up](README.md)")).toBe(
    "# Page\n\n[ai-toolkit](../../README.md) / [Up](README.md)\n\nText.\n",
  );
});

test("an earlier breadcrumb is found after the front page is renamed", () => {
  const old =
    "# Page\n\n[ai-toolkit](../README.md) / [Up](README.md)\n\nText.\n";
  expect(apply(old, "[Toolkit](../README.md) / [Up](README.md)")).toBe(
    "# Page\n\n[Toolkit](../README.md) / [Up](README.md)\n\nText.\n",
  );
});

test("a paragraph that only mentions the front page is left alone", () => {
  const text = "# Page\n\nSee [ai-toolkit](README.md) for more.\n";
  expect(apply(text, "[ai-toolkit](README.md)")).toContain(
    "See [ai-toolkit](README.md) for more.",
  );
});

test("a line of links that does not start at the front page is left alone", () => {
  const text = "# Page\n\n[One](one.md) / [Two](two.md)\n";
  expect(apply(text, "[ai-toolkit](README.md)")).toBe(
    "# Page\n\n[ai-toolkit](README.md)\n\n[One](one.md) / [Two](two.md)\n",
  );
});

test("an earlier breadcrumb is found after the page moves a folder deeper", () => {
  const old = "# Page\n\n[ai-toolkit](../README.md)\n\nText.\n";
  expect(apply(old, "[ai-toolkit](../../README.md) / [Up](../README.md)")).toBe(
    "# Page\n\n[ai-toolkit](../../README.md) / [Up](../README.md)\n\nText.\n",
  );
});

test("a line of links that starts at a README beside the page is left alone", () => {
  const text = "# Guide\n\n[Documentation](README.md) / [API](api.md)\n";
  const crumb = "[ai-toolkit](../README.md) / [Docs](README.md)";
  expect(apply(text, crumb)).toBe(
    `# Guide\n\n${crumb}\n\n[Documentation](README.md) / [API](api.md)\n`,
  );
});

test("a title with square brackets still gives one breadcrumb", () => {
  const path = "practices/engineering/code-review.md";
  const bracketed = (page: string): string =>
    page === "README.md" ? "Toolkit [preview]" : title(page);
  const crumb = render(path, ancestors(path, exists), bracketed);
  expect(crumb).toStartWith(String.raw`[Toolkit \[preview\]](../../README.md)`);
  const once = apply("# Page\n\nText.\n", crumb);
  expect(apply(once, crumb)).toBe(once);
});

test("scope covers reading pages and leaves out agent and published files", () => {
  expect(inScope("practices/engineering/code-review.md")).toBe(true);
  expect(inScope("docs/controls.md")).toBe(true);
  expect(inScope("plugins/commander/README.md")).toBe(true);
  expect(inScope("packages/README.md")).toBe(true);
  expect(inScope("README.md")).toBe(false);
  expect(inScope("rules/diagrams.md")).toBe(false);
  expect(inScope("plugins/wrap/skills/session/SKILL.md")).toBe(false);
  expect(inScope("packages/claude-local/README.md")).toBe(false);
  expect(inScope("packages/rag/CHANGELOG.md")).toBe(false);
});
