#!/usr/bin/env bun
/**
 * notify — push a message to the operator's phone through Pushover.
 *
 * The commander uses it when nobody is watching the terminal: a worker has
 * been stuck or waiting on approval for the threshold, or the operator has
 * not answered a question for the threshold.
 *
 * Usage:
 *   bun notify.ts send --key K --title T --message M [--url U] [--url-title UT]
 *                      [--priority -2..1] [--dry-run]
 *   bun notify.ts clear --key K | --prefix P
 *   bun notify.ts ask --key K --question Q [--after-seconds N] [--dry-run]
 *   bun notify.ts answered --key K
 *   bun notify.ts due [--dry-run]
 *
 * send      Pushes once per key per threshold window. A second send with the
 *           same key inside the window prints "skipped" and exits 0.
 * clear     Forgets the dedupe record, so the next send with that key goes
 *           out. Call it when the state that caused the push changes.
 * ask       Records a pending question and starts a detached timer. When the
 *           threshold passes and the question is still pending, the timer
 *           pushes it. The timer is an operating-system process, so it fires
 *           while the commander session is blocked on AskUserQuestion, when
 *           no cron tick can run.
 * answered  Removes the pending question. A timer that fires later finds it
 *           gone and does nothing.
 * due       Pushes every pending question older than the threshold. The nudge
 *           loop runs it as a backstop, for a timer lost to a reboot or held
 *           by quiet hours.
 *
 * Exit codes: 0 sent, skipped, held, disabled or dry run; 1 the API refused
 * or could not be reached; 2 missing credentials or bad arguments. A failed
 * push is never silent.
 *
 * Reads PUSHOVER_APP_TOKEN and PUSHOVER_USER_KEY from the environment only,
 * and never prints them.
 *
 * Environment for tests: COMMANDER_HOME (state directory, default
 * ~/.claude/commander), COMMANDER_ROSTER (default ~/.claude/commander.json),
 * NOTIFY_API (endpoint), NOTIFY_NOW (ISO time used as "now").
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API =
  process.env.NOTIFY_API ?? "https://api.pushover.net/1/messages.json";
const HOME =
  process.env.COMMANDER_HOME ?? join(homedir(), ".claude", "commander");
const ROSTER =
  process.env.COMMANDER_ROSTER ?? join(homedir(), ".claude", "commander.json");
const SENT = join(HOME, "notify.json");
const PENDING = join(HOME, "pending.json");
const LOG = join(HOME, "notify.log");

// Limits from https://pushover.net/api (checked 1 Oct 2026).
const LIMIT = { message: 1024, title: 250, url: 512, url_title: 100 };

interface Settings {
  enabled: boolean;
  thresholdMinutes: number;
  quietHours: { start: string; end: string } | null;
}

interface Sent {
  [key: string]: { sent_at: string; title: string };
}

interface Pending {
  [key: string]: { question: string; asked_at: string };
}

function now(): Date {
  return process.env.NOTIFY_NOW ? new Date(process.env.NOTIFY_NOW) : new Date();
}

function fail(code: number, why: string): never {
  console.error(`notify: ${why}`);
  process.exit(code);
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    fail(2, `cannot parse ${path}`);
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function log(line: string): void {
  mkdirSync(HOME, { recursive: true });
  appendFileSync(LOG, `${now().toISOString()} ${line}\n`, "utf8");
}

function settings(): Settings {
  const roster = readJson<{ notify?: Record<string, unknown> }>(ROSTER, {});
  const n = roster.notify ?? {};
  const quiet = n.quiet_hours as { start?: string; end?: string } | undefined;
  return {
    enabled: n.enabled !== false,
    thresholdMinutes:
      typeof n.threshold_minutes === "number" ? n.threshold_minutes : 30,
    quietHours:
      quiet?.start && quiet?.end
        ? { start: quiet.start, end: quiet.end }
        : null,
  };
}

/** Minutes since midnight, local time, for an "HH:MM" string or a Date. */
function minuteOfDay(value: string | Date): number {
  if (typeof value === "string") {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  }
  return value.getHours() * 60 + value.getMinutes();
}

function inQuietHours(s: Settings): boolean {
  if (!s.quietHours) return false;
  const t = minuteOfDay(now());
  const start = minuteOfDay(s.quietHours.start);
  const end = minuteOfDay(s.quietHours.end);
  // A window such as 22:00–07:00 crosses midnight.
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

function args(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(2, `unexpected argument: ${a}`);
    const name = a.slice(2);
    if (name === "dry-run") {
      out.set(name, "1");
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--"))
      fail(2, `--${name} needs a value`);
    out.set(name, value);
    i++;
  }
  return out;
}

function need(a: Map<string, string>, name: string): string {
  const v = a.get(name);
  if (!v) fail(2, `--${name} is required`);
  return v;
}

function credentials(): { token: string; user: string } {
  const token = process.env.PUSHOVER_APP_TOKEN ?? "";
  const user = process.env.PUSHOVER_USER_KEY ?? "";
  const missing = [
    !token && "PUSHOVER_APP_TOKEN",
    !user && "PUSHOVER_USER_KEY",
  ].filter(Boolean);
  if (missing.length)
    fail(2, `${missing.join(" and ")} not set; nothing was sent`);
  return { token, user };
}

async function post(
  body: URLSearchParams,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(API, { method: "POST", body });
  // A 5xx from a proxy may carry no JSON at all.
  const json = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return { status: res.status, json };
}

interface Message {
  key: string;
  title: string;
  message: string;
  url?: string;
  urlTitle?: string;
  priority: number;
  dryRun: boolean;
}

/** Push one message, honouring enabled, quiet hours and the dedupe window. */
async function send(m: Message): Promise<void> {
  const s = settings();
  if (!s.enabled) {
    console.log(
      `disabled: notify.enabled is false in the roster; ${m.key} not sent`,
    );
    return;
  }
  const { token, user } = credentials();
  const sent = readJson<Sent>(SENT, {});
  const last = sent[m.key];
  if (last) {
    const age = (now().getTime() - new Date(last.sent_at).getTime()) / 60000;
    if (age < s.thresholdMinutes) {
      console.log(`skipped: ${m.key} was sent ${Math.floor(age)}m ago`);
      return;
    }
  }
  if (inQuietHours(s)) {
    // Not recorded as sent, so the next attempt after quiet hours goes out.
    console.log(
      `held: quiet hours ${s.quietHours!.start}–${s.quietHours!.end}; ${m.key} not sent`,
    );
    return;
  }

  const body = new URLSearchParams({
    token,
    user,
    title: m.title.slice(0, LIMIT.title),
    message: m.message.slice(0, LIMIT.message),
    priority: String(m.priority),
  });
  if (m.url) body.set("url", m.url.slice(0, LIMIT.url));
  if (m.urlTitle) body.set("url_title", m.urlTitle.slice(0, LIMIT.url_title));

  if (m.dryRun) {
    const shown = [...body.entries()]
      .map(([k, v]) =>
        k === "token" || k === "user" ? `${k}=<set>` : `${k}=${v}`,
      )
      .join(" ");
    console.log(`dry run: ${m.key} would POST ${API} ${shown}`);
    log(`dry-run ${m.key} ${m.title}`);
    sent[m.key] = { sent_at: now().toISOString(), title: m.title };
    writeJson(SENT, sent);
    return;
  }

  let result: { status: number; json: Record<string, unknown> | null };
  try {
    result = await post(body);
    if (result.status >= 500) {
      // Pushover asks for at least 5 seconds before a retry after a 5xx.
      await Bun.sleep(5000);
      result = await post(body);
    }
  } catch (e) {
    fail(
      1,
      `could not reach Pushover (${(e as Error).message}); ${m.key} not sent`,
    );
  }
  const ok = result.status === 200 && result.json?.status === 1;
  if (!ok) {
    const errors = Array.isArray(result.json?.errors)
      ? (result.json!.errors as string[]).join("; ")
      : "no error detail";
    const why =
      result.status === 429 ? "monthly message limit reached" : errors;
    fail(1, `Pushover refused ${m.key} (HTTP ${result.status}): ${why}`);
  }
  log(`sent ${m.key} ${m.title} request=${result.json?.request ?? "?"}`);
  sent[m.key] = { sent_at: now().toISOString(), title: m.title };
  writeJson(SENT, sent);
  console.log(`sent: ${m.key}`);
}

function clear(a: Map<string, string>): void {
  const key = a.get("key");
  const prefix = a.get("prefix");
  if (!key && !prefix) fail(2, "clear needs --key or --prefix");
  const sent = readJson<Sent>(SENT, {});
  let n = 0;
  for (const k of Object.keys(sent)) {
    if ((key && k === key) || (prefix && k.startsWith(prefix))) {
      delete sent[k];
      n++;
    }
  }
  writeJson(SENT, sent);
  console.log(`cleared: ${n}`);
}

function ask(a: Map<string, string>): void {
  const key = need(a, "key");
  const question = need(a, "question");
  credentials();
  const pending = readJson<Pending>(PENDING, {});
  pending[key] = { question, asked_at: now().toISOString() };
  writeJson(PENDING, pending);

  const after = a.has("after-seconds")
    ? Number(a.get("after-seconds"))
    : settings().thresholdMinutes * 60;
  if (!Number.isFinite(after) || after < 0)
    fail(2, "--after-seconds must be a number of seconds");
  const fireArgs = [
    "fire",
    "--key",
    key,
    ...(a.has("dry-run") ? ["--dry-run"] : []),
  ];
  // A detached shell outlives this process and the commander session. The
  // key travels as an argument, never through the shell, so it cannot be
  // read as a command.
  const child = spawn(
    "/bin/sh",
    [
      "-c",
      `sleep ${Math.ceil(after)}; exec "$0" "$@"`,
      process.execPath,
      import.meta.path,
      ...fireArgs,
    ],
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
    },
  );
  child.unref();
  console.log(`pending: ${key}, push in ${Math.ceil(after)}s unless answered`);
}

function answered(a: Map<string, string>): void {
  const key = need(a, "key");
  const pending = readJson<Pending>(PENDING, {});
  const had = key in pending;
  delete pending[key];
  writeJson(PENDING, pending);
  const sent = readJson<Sent>(SENT, {});
  delete sent[`ask:${key}`];
  writeJson(SENT, sent);
  console.log(had ? `answered: ${key}` : `answered: ${key} was not pending`);
}

async function pushQuestion(
  key: string,
  question: string,
  askedAt: string,
  dryRun: boolean,
): Promise<void> {
  const minutes = Math.floor(
    (now().getTime() - new Date(askedAt).getTime()) / 60000,
  );
  await send({
    key: `ask:${key}`,
    title: "Commander is waiting for you",
    message: `${question.replace(/\s+/g, " ").trim()} (asked ${minutes}m ago)`,
    priority: 0,
    dryRun,
  });
}

async function fire(a: Map<string, string>): Promise<void> {
  const key = need(a, "key");
  const p = readJson<Pending>(PENDING, {})[key];
  if (!p) {
    log(`timer ${key}: answered before it fired`);
    return;
  }
  await pushQuestion(key, p.question, p.asked_at, a.has("dry-run"));
}

async function due(a: Map<string, string>): Promise<void> {
  const threshold = settings().thresholdMinutes;
  const pending = readJson<Pending>(PENDING, {});
  let n = 0;
  for (const [key, p] of Object.entries(pending)) {
    const age = (now().getTime() - new Date(p.asked_at).getTime()) / 60000;
    if (age >= threshold) {
      await pushQuestion(key, p.question, p.asked_at, a.has("dry-run"));
      n++;
    }
  }
  if (n === 0) console.log("due: none");
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const a = args(rest);
  switch (command) {
    case "send": {
      const priority = a.has("priority") ? Number(a.get("priority")) : 0;
      // Priority 2 needs retry and expire handling, which this script does not do.
      if (![-2, -1, 0, 1].includes(priority))
        fail(2, "--priority must be -2, -1, 0 or 1");
      await send({
        key: need(a, "key"),
        title: need(a, "title"),
        message: need(a, "message"),
        url: a.get("url"),
        urlTitle: a.get("url-title"),
        priority,
        dryRun: a.has("dry-run"),
      });
      return;
    }
    case "clear":
      return clear(a);
    case "ask":
      return ask(a);
    case "answered":
      return answered(a);
    case "fire":
      return fire(a);
    case "due":
      return due(a);
    default:
      fail(
        2,
        "usage: notify.ts send|clear|ask|answered|due [flags]; see the header",
      );
  }
}

await main();
