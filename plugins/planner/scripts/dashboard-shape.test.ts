import { expect, test } from "bun:test";

import { shapeProblems } from "./dashboard-shape";

const lines = (s: string) => s.split("\n");

const SOUND = `# Dashboard

## Focus

> [!note]- How to maintain this Focus log (for editors)
> Prose.

### Tuesday 13 October

#### **Acme**

- [ ] Today

> [!note]- Tomorrow
>
> ### Wednesday 14 October
>
> #### **Acme**
>
> - [ ] Tomorrow

> [!note]- Future
>
> ### Unscheduled — no day assigned

## Initiatives

- [ ] Outside Focus is not checked
### Not a Focus day either
`;

test("a sound dashboard has no problems", () => {
  expect(shapeProblems(lines(SOUND))).toEqual([]);
});

test("a dashboard between days, with no today, is sound", () => {
  const between = SOUND.replace(
    "### Tuesday 13 October\n\n#### **Acme**\n\n- [ ] Today\n\n",
    "",
  );
  expect(shapeProblems(lines(between))).toEqual([]);
});

test("a dashboard with no bands yet is sound", () => {
  expect(
    shapeProblems(lines("## Focus\n\n### Tuesday 13 October\n\n- [ ] x\n")),
  ).toEqual([]);
});

test("a day written unprefixed below the bands is reported twice over", () => {
  const stray = SOUND.replace(
    "\n## Initiatives",
    "\n### Tuesday 13 October\n\n#### **Acme**\n\n- [ ] Stray\n\n## Initiatives",
  );
  const problems = shapeProblems(lines(stray));
  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain("2 unprefixed day headings");
  expect(problems[0]).toContain("line 26: ### Tuesday 13 October");
  expect(problems[1]).toContain(
    '3 lines below the Tomorrow and Future callouts have no "> " prefix',
  );
});

test("a long run of offending lines is summarised", () => {
  const many = SOUND.replace(
    "\n## Initiatives",
    "\n- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n\n## Initiatives",
  );
  expect(shapeProblems(lines(many))[0]).toContain("; and 2 more");
});

test("two unprefixed days above the bands are reported", () => {
  const two = SOUND.replace(
    "> [!note]- Tomorrow",
    "### Wednesday 14 October\n\n- [ ] Early\n\n> [!note]- Tomorrow",
  );
  const problems = shapeProblems(lines(two));
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("2 unprefixed day headings");
});
