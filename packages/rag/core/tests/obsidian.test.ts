import { describe, expect, test } from "bun:test";

import {
  Exclusions,
  Frontmatter,
  ObsidianSource,
  TierMap,
} from "../src/obsidian";

describe("Exclusions", () => {
  test.each([
    ["Templates/Meeting Notes Template.md", "templates"],
    ["Dashboard.md", "volatile"],
    ["Dashboard.md.bak-2026-07-31", "system"],
    ["Notes.bak-old.md", "backup"],
    ["Dashboard 2.md", "volatile"],
    ["Clients/AcmeCo/Note 2.md", "conflict-copy"],
    ["Clients/AcmeCo/Note 12.md", "conflict-copy"],
    ["Clients/AcmeCo/Plan (conflict).md", "conflict-copy"],
    // a conflict copy of a dated note still ends in the counter
    ["Clients/AcmeCo/Handover, Tue 11 Aug 2026 2.md", "conflict-copy"],
    [".obsidian/config.md", "system"],
    ["_Attachments/scan.md", "system"],
    ["_Drafts/2026-08-14.md", "system"],
    ["_Drafts/nested/half-written.md", "system"],
    ["_OQ/OQ-2026-08-18T12-27-49.541Z.md", "system"],
    ["CLAUDE.md", "system"],
    ["Parked.md", "volatile"],
    ["Clients/AcmeCo/Initiatives/acme-app — Master Plan.md", "volatile"],
    ["Personal/Health/Sleep.md", "health-deferred"],
    ["image.png", "system"],
  ] as const)("excludes %s (%s)", (path, reason) => {
    expect(Exclusions.check(path)).toBe(reason);
  });

  test.each([
    "Clients/AcmeCo/Strategy.md",
    "Personal/Projects/Woodworking.md",
    "Management/Operations.md",
    "Archive/Old Plan.md",
    // plan subpages are indexed — only the master-plan worklist note is state
    "Clients/AcmeCo/Initiatives/acme-app/proj-101-feature.md",
    // a title ending in a year is not a conflict copy. The handover naming
    // convention ends in one, so an unbounded counter pattern hid every
    // handover note from the index.
    "Clients/AcmeCo/Handover — outbound delivery, Tue 11 Aug 2026.md",
    "Personal/Budget 2026.md",
    "Archive/Work Logs/2026.md",
    // the scratch folders match on a whole path segment, so a note that
    // merely mentions one in its name is still source material
    "Clients/AcmeCo/_Drafts review.md",
    "Management/_OQ process.md",
  ])("keeps %s", (path) => {
    expect(Exclusions.check(path)).toBeNull();
  });
});

describe("Exclusions.shouldTriggerScan", () => {
  test.each([
    "Dashboard.md",
    "Dashboard 2.md",
    ".obsidian/workspace.json",
    ".DS_Store",
    "Templates/Meeting Notes Template.md",
    "_Attachments/scan.pdf",
    "_Drafts/2026-08-14.md",
    "_OQ/OQ-2026-08-18T12-27-49.541Z.md",
    "Clients/AcmeCo/Plan (conflict).md",
    // "" is the watched root itself: iCloud touches the root directory's
    // metadata after every file write, so this event fires for excluded
    // files too and must not defeat the filter.
    "",
  ])("skips the scan for %p", (path) => {
    expect(Exclusions.shouldTriggerScan(path)).toBe(false);
  });

  test.each([
    "Clients/AcmeCo/Strategy.md",
    "Archive/Old Plan.md",
    // Unknown-shape events must scan: fs.watch may omit the filename, and a
    // dot-less segment can be a directory rename whose children get no events.
    null,
    "Clients/AcmeCo",
    "Clients/New Folder",
  ])("scans for %p", (path) => {
    expect(Exclusions.shouldTriggerScan(path)).toBe(true);
  });
});

describe("TierMap", () => {
  test("Personal/ is private; everything else is private-business", () => {
    expect(TierMap.derive("Personal/Projects/X.md")).toBe("private");
    expect(TierMap.derive("Clients/AcmeCo/Y.md")).toBe("private-business");
    expect(TierMap.derive("Management/Z.md")).toBe("private-business");
  });
});

describe("Frontmatter", () => {
  test("parses scalars and inline lists, strips the block from the body", () => {
    const md = `---\ntype: note\nclient: AcmeCo\ntags: [alpha, beta]\ncreated: 2026-01-01\n---\n# Body\n`;
    const { attrs, body } = Frontmatter.parse(md);
    expect(attrs).toEqual({
      client: "AcmeCo",
      created: "2026-01-01",
      tags: "alpha, beta",
      type: "note",
    });
    expect(body.trim()).toBe("# Body");
  });

  test("no frontmatter returns the full body", () => {
    const { attrs, body } = Frontmatter.parse("plain body");
    expect(attrs).toEqual({});
    expect(body).toBe("plain body");
  });
});

describe("ObsidianSource", () => {
  const content = `---\ntype: note\nclient: AcmeCo\n---\n## Topic\n\nSome insight.\n`;

  test("builds records with tier, metadata, and stable ids", () => {
    const records = ObsidianSource.toRecords(
      "Clients/AcmeCo/Insights.md",
      content,
      42,
    );
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.tier).toBe("private-business");
    expect(record?.metadata["client"]).toBe("AcmeCo");
    expect(record?.headingPath).toBe("Insights › Topic");
    expect(record?.modifiedAt).toBe(42);
    expect(record?.embedding).toEqual([]);
  });

  test("excluded paths produce zero records", () => {
    expect(ObsidianSource.toRecords("Templates/T.md", content, 1)).toEqual([]);
    expect(
      ObsidianSource.toRecords("Personal/Health/H.md", content, 1),
    ).toEqual([]);
  });

  test("record ids are stable across runs, and differ per chunk", () => {
    const first = ObsidianSource.toRecords(
      "Clients/AcmeCo/Insights.md",
      content,
      42,
    );
    const second = ObsidianSource.toRecords(
      "Clients/AcmeCo/Insights.md",
      content,
      99,
    );
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });
});
