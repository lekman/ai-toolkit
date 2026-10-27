#!/usr/bin/env bun
/**
 * Read meetings from Meetily's local database and write one meeting's
 * transcript as markdown.
 *
 *   bun export.ts --list [--limit 10]
 *   bun export.ts --meeting <id|latest> --out <file.md>
 *
 * The transcript text goes only to the --out file. Stdout carries metadata
 * (id, title, start, segment count, length), so the calling session never sees
 * what was said unless it reads the file. That is what lets a hosted session
 * export a meeting whose summary must be written by a local model.
 *
 * Meetily keeps its database in WAL mode while it runs. The script copies the
 * database and its -wal and -shm files to a temporary folder and opens the
 * copy, so it never locks or changes Meetily's own files.
 */
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

export const DEFAULT_DB = join(
  homedir(),
  "Library/Application Support/com.meetily.ai/meeting_minutes.sqlite",
);

export interface MeetingInfo {
  createdAt: string;
  id: string;
  minutes: number;
  segments: number;
  title: string;
}

interface Row {
  audio_start_time: null | number;
  speaker: null | string;
  timestamp: string;
  transcript: string;
}

/** Open a private copy of the database, including uncheckpointed WAL pages. */
export function openCopy(dbPath: string): { close: () => void; db: Database } {
  if (!existsSync(dbPath))
    throw new Error(`Meetily database not found: ${dbPath}`);
  const dir = mkdtempSync(join(tmpdir(), "meetily-"));
  const copy = join(dir, "meeting_minutes.sqlite");
  copyFileSync(dbPath, copy);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(dbPath + suffix))
      copyFileSync(dbPath + suffix, copy + suffix);
  }
  const db = new Database(copy);
  return {
    close: () => {
      db.close();
      rmSync(dir, { force: true, recursive: true });
    },
    db,
  };
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

/** Meetings newest first, with transcript segment count and length in minutes. */
export function listMeetings(db: Database, limit = 10): MeetingInfo[] {
  const length = hasColumn(db, "transcripts", "audio_end_time")
    ? "COALESCE(MAX(t.audio_end_time), 0)"
    : "0";
  const rows = db
    .query(
      `SELECT m.id, m.title, m.created_at, COUNT(t.id) AS segments, ${length} AS seconds
       FROM meetings m LEFT JOIN transcripts t ON t.meeting_id = m.id
       GROUP BY m.id ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(limit) as {
    created_at: string;
    id: string;
    seconds: number;
    segments: number;
    title: string;
  }[];
  return rows.map((r) => ({
    createdAt: r.created_at,
    id: r.id,
    minutes: Math.round(r.seconds / 60),
    segments: r.segments,
    title: r.title,
  }));
}

/** "125.3" seconds becomes "02:05"; an hour or more becomes "1:02:05". */
export function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Meetily stores "mic" for the local microphone and "system" for everyone else. */
function label(speaker: null | string): string {
  if (speaker === "mic") return "Me";
  if (speaker === "system") return "Them";
  return "";
}

/**
 * Join consecutive segments from the same speaker into one paragraph, stamped
 * with the time of its first segment.
 */
export function renderTranscript(meeting: MeetingInfo, rows: Row[]): string {
  const lines = [
    `# Transcript: ${meeting.title}`,
    "",
    `Recorded ${meeting.createdAt} with Meetily.`,
    "",
  ];
  let current: { speaker: string; stamp: string; text: string[] } | undefined;
  const flush = () => {
    if (!current) return;
    const who = current.speaker ? ` ${current.speaker}:` : "";
    lines.push(`**[${current.stamp}]${who}** ${current.text.join(" ")}`, "");
  };
  for (const row of rows) {
    const text = row.transcript.trim();
    if (!text) continue;
    const speaker = label(row.speaker);
    if (current && current.speaker === speaker) {
      current.text.push(text);
      continue;
    }
    flush();
    const stamp =
      row.audio_start_time === null
        ? row.timestamp
        : clock(row.audio_start_time);
    current = { speaker, stamp, text: [text] };
  }
  flush();
  return lines.join("\n");
}

/**
 * Write one meeting's transcript to `out` and return its metadata. `which` is a
 * meeting id or "latest". Refuses to overwrite an existing file.
 */
export function exportMeeting(
  db: Database,
  which: string,
  out: string,
): MeetingInfo & { out: string } {
  const meeting =
    which === "latest"
      ? listMeetings(db, 1)[0]
      : listMeetings(db, 10_000).find((m) => m.id === which);
  if (!meeting)
    throw new Error(
      which === "latest"
        ? "Meetily has no meetings yet"
        : `No meeting with id ${which}`,
    );
  if (meeting.segments === 0)
    throw new Error(`Meeting "${meeting.title}" has no transcript segments`);
  const start = hasColumn(db, "transcripts", "audio_start_time")
    ? "audio_start_time"
    : "NULL";
  const speaker = hasColumn(db, "transcripts", "speaker") ? "speaker" : "NULL";
  const rows = db
    .query(
      `SELECT transcript, timestamp, ${start} AS audio_start_time, ${speaker} AS speaker
       FROM transcripts WHERE meeting_id = ?
       ORDER BY audio_start_time IS NULL, audio_start_time, rowid`,
    )
    .all(meeting.id) as Row[];

  mkdirSync(dirname(out), { recursive: true });
  // "wx" creates the file and fails if it already exists, in one step.
  try {
    writeFileSync(out, renderTranscript(meeting, rows), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Refusing to overwrite ${out}`, { cause: err });
    }
    throw err;
  }
  return { ...meeting, out };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      db: { default: process.env.MEETILY_DB ?? DEFAULT_DB, type: "string" },
      limit: { default: "10", type: "string" },
      list: { type: "boolean" },
      meeting: { type: "string" },
      out: { type: "string" },
    },
  });
  let close = () => {};
  try {
    const copy = openCopy(values.db);
    close = copy.close;
    const db = copy.db;
    if (values.list) {
      console.log(
        JSON.stringify(listMeetings(db, Number(values.limit)), null, 2),
      );
    } else if (values.meeting && values.out) {
      console.log(
        JSON.stringify(exportMeeting(db, values.meeting, values.out), null, 2),
      );
    } else {
      console.error(
        "Usage: export.ts --list | --meeting <id|latest> --out <file.md>",
      );
      process.exitCode = 2;
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    close();
  }
}
