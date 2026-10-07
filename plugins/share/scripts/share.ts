#!/usr/bin/env bun
/**
 * share — publish temporary files on the tailnet, and put a local site on it.
 *
 * Usage:
 *   bun share.ts add <path>... [--title T] [--ttl 24h] [--session ID] [--name N]
 *   bun share.ts remove <share-id>... | --session [ID] | --expired
 *   bun share.ts list [--json]
 *   bun share.ts up                start the files site and put it on the tailnet
 *   bun share.ts down              take the files site off the tailnet and stop it
 *   bun share.ts serve             run the files site in the foreground (`up` starts this)
 *   bun share.ts expose <port>     put a site listening on 127.0.0.1:<port> on the tailnet
 *   bun share.ts unexpose <port>   take it off again
 *   bun share.ts exposed           list what this machine serves on the tailnet
 *
 * add      Copies the paths into a new share, so the share keeps what was shared even when
 *          the originals change or a temp directory is cleaned. Records the session that
 *          shared it (id, name and working directory) and when, then makes sure the files
 *          site is up and prints the share's address.
 * remove   Deletes shares by id, every share of one session (this one when no id is given),
 *          or every expired share.
 * expose   Runs `tailscale serve`, which proxies the tailnet name to 127.0.0.1. Nothing is
 *          opened on the LAN or the internet.
 *
 * The files site listens on 127.0.0.1 only, so the tailnet is the one way in.
 *
 * Environment: SHARE_HOME (state, default ~/.claude/share), SHARE_PORT (default 8765),
 * CLAUDE_CODE_SESSION_ID (the calling session, set by Claude Code in its shell),
 * CLAUDE_SESSIONS_DIR (default ~/.claude/sessions, where the session's name is looked up),
 * SHARE_NO_TAILNET=1 (tests: never call tailscale and never start the site).
 *
 * Exit codes: 0 done; 1 tailscale or the site failed; 2 bad arguments or a missing path.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join, resolve, sep } from "node:path";

/** One set of shared files, as `share.json` in its own directory. */
export interface Share {
  expiresAt: string;
  files: { bytes: number; dir: boolean; name: string }[];
  id: string;
  /** The Claude Code session that shared the files. */
  session: { cwd: string; id: null | string; name: null | string };
  sharedAt: string;
  title: string;
}

const home = () =>
  process.env.SHARE_HOME ?? join(homedir(), ".claude", "share");
const port = () => Number(process.env.SHARE_PORT ?? 8765);
const noTailnet = () => process.env.SHARE_NO_TAILNET === "1";
const MARKER = "ai-toolkit share";

const fail = (code: number, message: string): never => {
  console.error(message);
  process.exit(code);
};

// ---------------------------------------------------------------- registry

/** Every share on disk, newest first. A directory without a readable `share.json` is skipped. */
export function readShares(root = home()): Share[] {
  if (!existsSync(root)) return [];
  const shares: Share[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      shares.push(
        JSON.parse(
          readFileSync(join(root, entry.name, "share.json"), "utf8"),
        ) as Share,
      );
    } catch {
      // A share being written or half removed.
    }
  }
  return shares.sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
}

/** True when the share's expiry has passed. */
export const expired = (s: Share, now = new Date()) =>
  new Date(s.expiresAt) <= now;

/** Removes every expired share and returns their ids. */
export function sweep(root = home(), now = new Date()): string[] {
  const gone = readShares(root).filter((s) => expired(s, now));
  for (const s of gone)
    rmSync(join(root, s.id), { force: true, recursive: true });
  return gone.map((s) => s.id);
}

/** Parses a lifetime such as 30m, 24h or 7d into milliseconds. */
export function parseTtl(ttl: string): number {
  const m = /^(\d+)([mhd])$/.exec(ttl.trim());
  if (!m)
    throw new Error(
      `--ttl takes a number and m, h or d, such as 24h; got "${ttl}"`,
    );
  return (
    Number(m[1]) *
    { d: 86_400_000, h: 3_600_000, m: 60_000 }[m[2] as "d" | "h" | "m"]
  );
}

/**
 * The session's name, from the file Claude Code keeps per running session
 * (`~/.claude/sessions/<pid>.json`, seen with `sessionId` and `name` in version 2.1.280).
 * Not a documented interface, so a missing or changed file gives null, not an error.
 */
export function sessionName(
  id: null | string,
  dir = process.env.CLAUDE_SESSIONS_DIR ??
    join(homedir(), ".claude", "sessions"),
): null | string {
  if (!id || !existsSync(dir)) return null;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        name?: string;
        sessionId?: string;
      };
      if (s.sessionId === id && s.name) return s.name;
    } catch {
      // Another session's file being rewritten.
    }
  }
  return null;
}

const size = (path: string): number => {
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce(
    (sum, name) => sum + size(join(path, name)),
    0,
  );
};

const newId = (now: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `${stamp}-${crypto.randomUUID().slice(0, 4)}`;
};

/** Copies the paths into a new share and records who shared it and when. */
export function addShare(
  paths: string[],
  opts: {
    name?: string;
    now?: Date;
    session?: null | string;
    title?: string;
    ttl?: string;
  },
  root = home(),
): Share {
  if (paths.length === 0) throw new Error("add needs at least one path");
  const missing = paths.filter((p) => !existsSync(p));
  if (missing.length) throw new Error(`not found: ${missing.join(", ")}`);
  const now = opts.now ?? new Date();
  const id = newId(now);
  const filesDir = join(root, id, "files");
  mkdirSync(filesDir, { recursive: true });
  const files: Share["files"] = [];
  for (const path of paths) {
    let name = basename(resolve(path));
    for (let n = 2; files.some((f) => f.name === name); n++)
      name = `${n}-${basename(resolve(path))}`;
    cpSync(path, join(filesDir, name), { recursive: true });
    files.push({
      bytes: size(join(filesDir, name)),
      dir: statSync(path).isDirectory(),
      name,
    });
  }
  const sessionId = opts.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
  const share: Share = {
    expiresAt: new Date(
      now.getTime() + parseTtl(opts.ttl ?? "24h"),
    ).toISOString(),
    files,
    id,
    session: {
      cwd: process.cwd(),
      id: sessionId,
      name: opts.name ?? sessionName(sessionId),
    },
    sharedAt: now.toISOString(),
    title: opts.title ?? files.map((f) => f.name).join(", "),
  };
  writeFileSync(join(root, id, "share.json"), JSON.stringify(share, null, 2));
  return share;
}

/** Removes shares and returns the ids removed. */
export function removeShares(
  sel: { expired?: boolean; ids?: string[]; session?: string },
  root = home(),
): string[] {
  if (sel.expired) return sweep(root);
  const all = readShares(root);
  const gone = sel.session
    ? all.filter((s) => s.session.id === sel.session)
    : all.filter((s) => sel.ids?.includes(s.id));
  for (const s of gone)
    rmSync(join(root, s.id), { force: true, recursive: true });
  return gone.map((s) => s.id);
}

// ------------------------------------------------------------------ the site

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    weekday: "short",
  });
const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1_048_576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1_048_576).toFixed(1)} MB`;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --muted: #6b7280; --line: #d1d5db; --card: #f9fafb; }
  @media (prefers-color-scheme: dark) { :root { --muted: #9ca3af; --line: #374151; --card: #111827; } }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { margin: 0 0 4px; } h2 { font-size: 1.1rem; margin: 32px 0 8px; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .share { border: 1px solid var(--line); background: var(--card); border-radius: 8px; padding: 12px 16px; margin: 12px 0; }
  .share h3 { margin: 0 0 2px; font-size: 1rem; }
  ul { margin: 8px 0 0; padding-left: 20px; } img { display: block; max-width: min(100%, 360px); margin: 6px 0; border: 1px solid var(--line); }
  code { font-size: 0.85em; }
</style></head><body>${body}</body></html>`;

const sessionLine = (s: Share["session"]) =>
  `Session <strong>${esc(s.name ?? "unnamed")}</strong>${s.id ? ` <code>${esc(s.id.slice(0, 8))}</code>` : ""} · <code>${esc(s.cwd)}</code>`;

const shareCard = (s: Share, linkTitle: boolean) => {
  const files = s.files
    .map((f) => {
      const href = `/s/${encodeURIComponent(s.id)}/${encodeURIComponent(f.name)}${f.dir ? "/" : ""}`;
      const thumb = IMAGE.test(f.name)
        ? `<a href="${href}"><img src="${href}" alt="${esc(f.name)}" loading="lazy"></a>`
        : "";
      return `<li><a href="${href}">${esc(f.name)}${f.dir ? "/" : ""}</a> <span class="muted">${bytes(f.bytes)}</span>${thumb}</li>`;
    })
    .join("");
  const title = linkTitle
    ? `<a href="/s/${encodeURIComponent(s.id)}/">${esc(s.title)}</a>`
    : esc(s.title);
  return `<section class="share"><h3>${title}</h3>
<div class="muted">Shared ${when(s.sharedAt)} · removed ${when(s.expiresAt)} · <code>${esc(s.id)}</code></div><ul>${files}</ul></section>`;
};

const indexPage = (shares: Share[], session: null | string) => {
  const shown = session
    ? shares.filter((s) => s.session.id === session)
    : shares;
  const groups = new Map<string, Share[]>();
  for (const s of shown) {
    const key = s.session.id ?? `cwd:${s.session.cwd}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const body = [...groups.values()]
    .map((g) => {
      const filter = g[0]!.session.id
        ? ` · <a href="/?session=${encodeURIComponent(g[0]!.session.id)}">only this session</a>`
        : "";
      return `<h2>${sessionLine(g[0]!.session)}${filter}</h2>${g.map((s) => shareCard(s, true)).join("")}`;
    })
    .join("");
  return page(
    "Shared files",
    `<h1>Shared files</h1>
<p class="muted">Temporary files that Claude Code sessions on <strong>${esc(hostname())}</strong> shared, grouped by the session that shared them, newest first. Each share is removed at the time shown.${session ? ` Showing one session; <a href="/">show all</a>.` : ""}</p>
${body || `<p>Nothing is shared right now.</p>`}`,
  );
};

const dirPage = (s: Share, rel: string, abs: string) => {
  const items = readdirSync(abs, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (e) =>
        `<li><a href="${encodeURIComponent(e.name)}${e.isDirectory() ? "/" : ""}">${esc(e.name)}${e.isDirectory() ? "/" : ""}</a></li>`,
    )
    .join("");
  return page(
    rel,
    `<p><a href="/s/${encodeURIComponent(s.id)}/">${esc(s.title)}</a></p><h1>${esc(rel)}</h1><p class="muted">${sessionLine(s.session)}</p><ul>${items}</ul>`,
  );
};

const html = (body: string, status = 200) =>
  new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
    status,
  });

/** The files site. Exported so the tests can call it without a socket. */
export function handle(
  req: Request,
  root = home(),
  now = new Date(),
): Response {
  const url = new URL(req.url);
  if (req.method !== "GET" && req.method !== "HEAD")
    return new Response("Method not allowed", { status: 405 });
  if (url.pathname === "/healthz") return new Response(MARKER);
  const live = readShares(root).filter((s) => !expired(s, now));
  if (url.pathname === "/")
    return html(indexPage(live, url.searchParams.get("session")));
  const m = /^\/s\/([^/]+)\/(.*)$/.exec(url.pathname);
  if (!m) return html(page("Not found", "<h1>Not found</h1>"), 404);
  const share = live.find((s) => s.id === decodeURIComponent(m[1]!));
  if (!share)
    return html(
      page(
        "Gone",
        `<h1>Not shared</h1><p>This share was removed or has expired. <a href="/">All shares</a></p>`,
      ),
      404,
    );
  if (m[2] === "")
    return html(
      page(
        share.title,
        `<p><a href="/">All shares</a></p><p class="muted">${sessionLine(share.session)}</p>${shareCard(share, false)}`,
      ),
    );
  const filesDir = join(root, share.id, "files");
  const rel = decodeURIComponent(m[2]!);
  const abs = resolve(filesDir, rel);
  if (!abs.startsWith(filesDir + sep) || !existsSync(abs))
    return html(page("Not found", "<h1>Not found</h1>"), 404);
  if (statSync(abs).isDirectory()) {
    if (!url.pathname.endsWith("/"))
      return Response.redirect(`${url.pathname}/`, 301);
    if (existsSync(join(abs, "index.html")))
      return new Response(Bun.file(join(abs, "index.html")));
    return html(dirPage(share, rel, abs));
  }
  return new Response(Bun.file(abs));
}

// ------------------------------------------------------------------- tailnet

const TAILSCALE_APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

function tailscale(args: string[]): string {
  const bin =
    existsSync(TAILSCALE_APP) && !onPath("tailscale")
      ? TAILSCALE_APP
      : "tailscale";
  try {
    return execFileSync(bin, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stderr?: string };
    const text = (err.stderr ?? String(e))
      .split("\n")
      .filter((l) => !l.startsWith("Warning: client version"))
      .join("\n")
      .trim();
    return fail(1, `tailscale ${args.join(" ")} failed: ${text}`);
  }
}

function onPath(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** This machine's MagicDNS name, such as host.tailnet.ts.net. */
function dnsName(): string {
  const self = (
    JSON.parse(tailscale(["status", "--self", "--json"])) as {
      Self: { DNSName: string };
    }
  ).Self;
  return self.DNSName.replace(/\.$/, "");
}

async function answers(url: string): Promise<boolean> {
  return (await probe(url)) !== null;
}

/** The status and the start of the body, or null when nothing answers. */
async function probe(
  url: string,
): Promise<null | { status: number; text: string }> {
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, text: (await res.text()).slice(0, 200) };
  } catch {
    return null;
  }
}

/** True when a dev server refused the request because of its Host header, as Storybook and Vite do. */
export const hostRefused = (r: null | { status: number; text: string }) =>
  !!r &&
  r.status === 403 &&
  /invalid host|blocked request|not allowed/i.test(r.text);

/** Addresses other than loopback that the port listens on, from lsof. Empty when lsof is missing. */
function wideListeners(p: number): string[] {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${p}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    return [
      ...new Set(
        out
          .split("\n")
          .slice(1)
          .map((l) => l.split(/\s+/)[8] ?? "")
          .filter((a) => a && !/^(127\.0\.0\.1|\[::1\]|localhost):/.test(a)),
      ),
    ];
  } catch {
    return [];
  }
}

/** Puts 127.0.0.1:<port> on the tailnet and returns the tailnet address, after checking it answers there. */
export async function expose(p: number): Promise<string> {
  if (!(await answers(`http://127.0.0.1:${p}/`)))
    fail(
      1,
      `Nothing answers on http://127.0.0.1:${p}/. Start the site first, bound to 127.0.0.1.`,
    );
  const wide = wideListeners(p);
  tailscale(["serve", "--bg", `--http=${p}`, `http://127.0.0.1:${p}`]);
  const url = `http://${dnsName()}:${p}/`;
  const seen = await probe(url);
  if (!seen)
    fail(
      1,
      `tailscale serve is set, but ${url} does not answer from this machine.`,
    );
  if (hostRefused(seen))
    fail(
      1,
      `${url} is on the tailnet, but the site refuses the host name (it answered 403 "${seen!.text.trim()}"). ` +
        `Allow .ts.net in the server's host check and restart it: Storybook core.allowedHosts: [".ts.net"] in .storybook/main.ts; ` +
        `Vite server.allowedHosts: [".ts.net"]. The tailscale serve setting stays, so the address works once the site allows it.`,
    );
  if (wide.length)
    console.error(
      `Warning: port ${p} also listens on ${wide.join(", ")}, so the local network can reach it too. Restart the site bound to 127.0.0.1 to keep it tailnet only.`,
    );
  return url;
}

async function up(): Promise<string> {
  const p = port();
  if (!(await answers(`http://127.0.0.1:${p}/healthz`))) {
    mkdirSync(home(), { recursive: true });
    const log = openSync(join(home(), "site.log"), "a");
    const child = spawn(process.execPath, [import.meta.path, "serve"], {
      detached: true,
      env: process.env,
      stdio: ["ignore", log, log],
    });
    child.unref();
    for (
      let i = 0;
      i < 50 && !(await answers(`http://127.0.0.1:${p}/healthz`));
      i++
    )
      await Bun.sleep(100);
    if (!(await answers(`http://127.0.0.1:${p}/healthz`)))
      fail(1, `The files site did not start; see ${join(home(), "site.log")}.`);
  } else {
    const who = await (await fetch(`http://127.0.0.1:${p}/healthz`)).text();
    if (who !== MARKER)
      fail(
        1,
        `Port ${p} is taken by something else. Set SHARE_PORT to another port.`,
      );
  }
  return expose(p);
}

// ----------------------------------------------------------------------- CLI

function flags(argv: string[]) {
  const rest: string[] = [];
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const next = argv[i + 1];
    if (
      next !== undefined &&
      !next.startsWith("--") &&
      ["name", "session", "title", "ttl"].includes(a.slice(2))
    ) {
      opts[a.slice(2)] = next;
      i++;
    } else opts[a.slice(2)] = true;
  }
  return { opts, rest };
}

const str = (v: string | true | undefined) =>
  typeof v === "string" ? v : undefined;

async function main(argv: string[]) {
  const [cmd, ...args] = argv;
  const { opts, rest } = flags(args);
  switch (cmd) {
    case "add": {
      let share: Share;
      try {
        sweep();
        share = addShare(rest, {
          name: str(opts.name),
          session: str(opts.session),
          title: str(opts.title),
          ttl: str(opts.ttl),
        });
      } catch (e) {
        return fail(2, (e as Error).message);
      }
      console.log(`Shared ${share.files.length} item(s) as ${share.id}`);
      console.log(
        `Session: ${share.session.name ?? "unnamed"} (${share.session.id ?? "no session id"}) in ${share.session.cwd}`,
      );
      console.log(
        `Shared at ${share.sharedAt}; removed after ${share.expiresAt}`,
      );
      if (noTailnet()) return;
      const base = await up();
      console.log(`Open: ${base}s/${share.id}/`);
      console.log(`All shares: ${base}`);
      return;
    }
    case "remove": {
      const sel = opts.expired
        ? { expired: true }
        : opts.session
          ? { session: str(opts.session) ?? process.env.CLAUDE_CODE_SESSION_ID }
          : { ids: rest };
      if ("session" in sel && !sel.session)
        return fail(
          2,
          "remove --session needs an id when CLAUDE_CODE_SESSION_ID is not set",
        );
      if ("ids" in sel && sel.ids.length === 0)
        return fail(2, "remove needs share ids, --session [ID] or --expired");
      const gone = removeShares(sel);
      console.log(
        gone.length ? `Removed ${gone.join(", ")}` : "Nothing to remove",
      );
      return;
    }
    case "list": {
      sweep();
      const shares = readShares();
      if (opts.json) return console.log(JSON.stringify(shares, null, 2));
      if (!shares.length) return console.log("Nothing is shared.");
      for (const s of shares)
        console.log(
          [
            s.id,
            s.sharedAt,
            `${s.session.name ?? "unnamed"} ${s.session.id?.slice(0, 8) ?? ""}`.trim(),
            s.title,
            `${s.files.length} item(s)`,
            `until ${s.expiresAt}`,
          ].join("\t"),
        );
      return;
    }
    case "serve": {
      mkdirSync(home(), { recursive: true });
      sweep();
      setInterval(() => sweep(), 3_600_000);
      Bun.serve({
        fetch: (req) => handle(req),
        hostname: "127.0.0.1",
        port: port(),
      });
      console.log(
        `files site on http://127.0.0.1:${port()}/ (pid ${process.pid})`,
      );
      writeFileSync(join(home(), "site.pid"), String(process.pid));
      return;
    }
    case "up":
      return console.log(await up());
    case "down": {
      tailscale(["serve", `--http=${port()}`, "off"]);
      const pidFile = join(home(), "site.pid");
      if (existsSync(pidFile)) {
        try {
          process.kill(Number(readFileSync(pidFile, "utf8")));
        } catch {
          // Already stopped.
        }
        rmSync(pidFile, { force: true });
      }
      return console.log(
        "The files site is off the tailnet and stopped. The shares stay on disk until they expire or are removed.",
      );
    }
    case "expose": {
      const p = Number(rest[0]);
      if (!Number.isInteger(p) || p <= 0)
        return fail(2, "expose needs a port, such as 6006");
      return console.log(await expose(p));
    }
    case "unexpose": {
      const p = Number(rest[0]);
      if (!Number.isInteger(p) || p <= 0)
        return fail(2, "unexpose needs a port");
      tailscale(["serve", `--http=${p}`, "off"]);
      return console.log(`Port ${p} is off the tailnet.`);
    }
    case "exposed":
      return console.log(tailscale(["serve", "status"]).trim());
    default:
      return fail(
        2,
        "usage: share.ts add|remove|list|up|down|serve|expose|unexpose|exposed (see the header of this file)",
      );
  }
}

if (import.meta.main) await main(process.argv.slice(2));
