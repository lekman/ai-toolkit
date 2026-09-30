import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dir, "check-moves.ts");
const LOG = "Archive/Work Logs/2026/September.md";

const BOARD = `## Focus

### Tuesday 29 September

#### **Acme**

- [ ] Draft the workshop programme
- [ ] Review the schema proposal

> [!note]- Tomorrow
>
> ### Wednesday 30 September
>
> #### **Acme**
>
> - [ ] Rewrite the onboarding guide

> [!note]- Future
>
> ### Thursday 1 October
>
> #### **Acme**
>
> - [ ] Submit the timesheet

## Initiatives
`;

/** Write before/after trees and run the check against them. */
function check(
  before: Record<string, string>,
  after: Record<string, string>,
  flags: string[] = [],
) {
  const root = mkdtempSync(join(tmpdir(), "check-"));
  for (const [side, files] of [
    ["before", before],
    ["after", after],
  ] as const) {
    for (const [name, text] of Object.entries(files)) {
      const path = join(root, side, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf8");
    }
  }
  const proc = Bun.spawnSync([
    "bun",
    SCRIPT,
    join(root, "before"),
    join(root, "after"),
    "Dashboard.md",
    LOG,
    ...flags,
  ]);
  return { code: proc.exitCode, out: proc.stdout.toString() };
}

test("an unchanged board passes", () => {
  const r = check({ "Dashboard.md": BOARD }, { "Dashboard.md": BOARD }, [
    "--today",
    "Tuesday 29 September",
  ]);
  expect(r.code).toBe(0);
  expect(r.out).toBe("OK 4 items\n");
});

test("moving an item between bands passes", () => {
  const moved = BOARD.replace("- [ ] Review the schema proposal\n", "").replace(
    "> - [ ] Rewrite the onboarding guide",
    "> - [ ] Rewrite the onboarding guide\n> - [ ] Review the schema proposal",
  );
  expect(check({ "Dashboard.md": BOARD }, { "Dashboard.md": moved }).code).toBe(
    0,
  );
});

test("a deleted item fails", () => {
  const cut = BOARD.replace("- [ ] Review the schema proposal\n", "");
  const r = check({ "Dashboard.md": BOARD }, { "Dashboard.md": cut });
  expect(r.code).toBe(1);
  expect(r.out).toContain("LOST:   - [ ] Review the schema proposal");
});

test("a reworded item fails both ways", () => {
  const edit = BOARD.replace("Review the schema", "Review the new schema");
  const r = check({ "Dashboard.md": BOARD }, { "Dashboard.md": edit });
  expect(r.out).toContain("LOST:");
  expect(r.out).toContain("GAINED:");
});

test("a roll that drops a claim marker passes", () => {
  const claimed = BOARD.replace(
    "- [ ] Review the schema proposal",
    "- [ ] 🔄 Review the schema proposal",
  );
  const rolled = BOARD.replace(
    "- [ ] Review the schema proposal\n",
    "",
  ).replace(
    "> - [ ] Rewrite the onboarding guide",
    "> - [ ] Rewrite the onboarding guide\n> - [ ] Review the schema proposal",
  );
  expect(
    check({ "Dashboard.md": claimed }, { "Dashboard.md": rolled }).code,
  ).toBe(0);
});

test("a claimed item that is reworded still fails", () => {
  const claimed = BOARD.replace(
    "- [ ] Review the schema proposal",
    "- [ ] 🔄 Review the schema proposal",
  );
  const edit = BOARD.replace("Review the schema", "Review the new schema");
  const r = check({ "Dashboard.md": claimed }, { "Dashboard.md": edit });
  expect(r.code).toBe(1);
  expect(r.out).toContain("LOST:");
});

test("a ticked item fails", () => {
  const ticked = BOARD.replace(
    "- [ ] Draft the workshop",
    "- [x] Draft the workshop",
  );
  expect(
    check({ "Dashboard.md": BOARD }, { "Dashboard.md": ticked }).code,
  ).toBe(1);
});

test("archiving into a new work log passes", () => {
  const done = BOARD.replace(
    "- [ ] Draft the workshop",
    "- [x] Draft the workshop",
  );
  const archived = done.replace("- [x] Draft the workshop programme\n", "");
  const r = check(
    { "Dashboard.md": done },
    {
      "Dashboard.md": archived,
      [LOG]:
        "#### Tuesday 29 September\n\n**Acme**\n\n- [x] Draft the workshop programme\n",
    },
  );
  expect(r.code).toBe(0);
});

test("a day with open items that disappears fails", () => {
  const gone = BOARD.replace(
    /> ### Thursday 1 October[\s\S]*?> - \[ \] Submit the timesheet\n/,
    "> #### **Acme**\n>\n> - [ ] Submit the timesheet\n",
  );
  const r = check({ "Dashboard.md": BOARD }, { "Dashboard.md": gone });
  expect(r.out).toContain("DAY LOST: Thursday 1 October");
});

test("a past day rolled away with its open items passes", () => {
  // The roll moved both of Tuesday's items into Wednesday, which became today.
  const rolled = `## Focus

### Wednesday 30 September

#### **Acme**

- [ ] Rewrite the onboarding guide
- [ ] Draft the workshop programme
- [ ] Review the schema proposal

> [!note]- Tomorrow
>
> ### Thursday 1 October
>
> #### **Acme**
>
> - [ ] Submit the timesheet

> [!note]- Future

## Initiatives
`;
  const r = check({ "Dashboard.md": BOARD }, { "Dashboard.md": rolled }, [
    "--today",
    "Wednesday 30 September",
  ]);
  expect(r.out).toBe("OK 4 items\n");
});

test("a past day that disappears with its items still fails on the items", () => {
  const gone = BOARD.replace(
    /### Tuesday 29 September[\s\S]*?(?=> \[!note\]- Tomorrow)/,
    "",
  );
  const r = check({ "Dashboard.md": BOARD }, { "Dashboard.md": gone });
  expect(r.code).toBe(1);
  expect(r.out).toContain("LOST:   - [ ] Review the schema proposal");
});

test("--today rejects a stale board", () => {
  const r = check({ "Dashboard.md": BOARD }, { "Dashboard.md": BOARD }, [
    "--today",
    "Wednesday 30 September",
  ]);
  expect(r.code).toBe(1);
  expect(r.out).toContain("TODAY:");
});

test("--today rejects two days in Tomorrow", () => {
  const two = BOARD.replace(
    "> - [ ] Rewrite the onboarding guide",
    "> - [ ] Rewrite the onboarding guide\n>\n> ### Thursday 1 October\n>\n> #### **Acme**",
  ).replace(
    /> \[!note\]- Future\n>\n> ### Thursday 1 October\n>\n> #### \*\*Acme\*\*\n>\n/,
    "> [!note]- Future\n>\n",
  );
  const r = check({ "Dashboard.md": BOARD }, { "Dashboard.md": two }, [
    "--today",
    "Tuesday 29 September",
  ]);
  expect(r.out).toContain("TOMORROW: holds 2 days");
});
