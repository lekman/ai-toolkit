import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clock, exportMeeting, listMeetings, openCopy } from "./export";

const SCRIPT = join(import.meta.dir, "export.ts");

/** A database with Meetily's schema after its 2025-11 migrations. */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "meeting-test-"));
  const path = join(dir, "meeting_minutes.sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, folder_path TEXT);
    CREATE TABLE transcripts (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, transcript TEXT NOT NULL,
      timestamp TEXT NOT NULL, summary TEXT, action_items TEXT, key_points TEXT,
      audio_start_time REAL, audio_end_time REAL, duration REAL, speaker TEXT);
    INSERT INTO meetings VALUES ('old', 'Kick-off', '2026-10-20T09:00:00Z', '2026-10-20T09:00:00Z', NULL);
    INSERT INTO meetings VALUES ('new', 'Weekly call', '2026-10-27T18:00:00Z', '2026-10-27T18:00:00Z', NULL);
    INSERT INTO transcripts VALUES ('a', 'new', ' Hello all. ', '18:00:01', NULL, NULL, NULL, 1.2, 3.0, 1.8, 'mic');
    INSERT INTO transcripts VALUES ('c', 'new', 'Thanks.', '18:01:05', NULL, NULL, NULL, 65.0, 66.0, 1.0, 'system');
    INSERT INTO transcripts VALUES ('b', 'new', 'Shall we start?', '18:00:04', NULL, NULL, NULL, 3.1, 5.0, 1.9, 'mic');
    INSERT INTO transcripts VALUES ('d', 'new', 'Release is Friday.', '18:02:00', NULL, NULL, NULL, 3725.0, 3727.5, 2.5, 'system');
    INSERT INTO transcripts VALUES ('e', 'old', 'Unlabelled line.', '09:00:10', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO transcripts VALUES ('f', 'old', 'Next unlabelled line.', '09:00:40', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  `);
  db.close();
  return path;
}

test("clock formats minutes, and hours only when needed", () => {
  expect(clock(125.3)).toBe("02:05");
  expect(clock(3725)).toBe("1:02:05");
});

test("lists newest first with segment count and length", () => {
  const { close, db } = openCopy(fixture());
  const list = listMeetings(db);
  close();
  expect(list.map((m) => m.id)).toEqual(["new", "old"]);
  expect(list[0]).toMatchObject({
    minutes: 62,
    segments: 4,
    title: "Weekly call",
  });
});

test("exports in audio order, joins a speaker's consecutive segments, labels Me and Them", () => {
  const { close, db } = openCopy(fixture());
  const out = join(
    mkdtempSync(join(tmpdir(), "meeting-out-")),
    "nested",
    "t.md",
  );
  const info = exportMeeting(db, "latest", out);
  close();
  expect(info.id).toBe("new");
  const md = readFileSync(out, "utf8");
  expect(md).toContain("**[00:01] Me:** Hello all. Shall we start?");
  expect(md).toContain("**[01:05] Them:** Thanks. Release is Friday.");
});

test("keeps unlabelled segments on their own lines with the stored timestamp", () => {
  const { close, db } = openCopy(fixture());
  const out = join(mkdtempSync(join(tmpdir(), "meeting-out-")), "t.md");
  exportMeeting(db, "old", out);
  close();
  const md = readFileSync(out, "utf8");
  expect(md).toContain("**[09:00:10]** Unlabelled line.\n");
  expect(md).toContain("**[09:00:40]** Next unlabelled line.");
});

test("refuses to overwrite an existing file", () => {
  const { close, db } = openCopy(fixture());
  const out = join(mkdtempSync(join(tmpdir(), "meeting-out-")), "t.md");
  writeFileSync(out, "keep me");
  expect(() => exportMeeting(db, "latest", out)).toThrow(
    "Refusing to overwrite",
  );
  close();
  expect(readFileSync(out, "utf8")).toBe("keep me");
});

test("CLI prints metadata only, never the transcript text", () => {
  const db = fixture();
  const out = join(mkdtempSync(join(tmpdir(), "meeting-out-")), "t.md");
  const proc = Bun.spawnSync(
    ["bun", SCRIPT, "--meeting", "latest", "--out", out],
    {
      env: { ...process.env, MEETILY_DB: db },
    },
  );
  const stdout = proc.stdout.toString();
  expect(proc.exitCode).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ id: "new", out, segments: 4 });
  expect(stdout).not.toContain("Release is Friday");
  expect(existsSync(out)).toBe(true);
});
