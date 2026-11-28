/**
 * The home page of what this machine shares on the tailnet: the services it
 * serves, the pages shared with `share.ts page`, and the file shares.
 *
 * Everything lives under the share folder (SHARE_HOME, default
 * ~/.claude/share):
 *
 * - `config.json`: `publicBase`, an easy address that redirects to this
 *   machine's tailnet HTTPS address (for example `https://server.example.com`).
 *   Without it, links use the tailnet address. The site is mounted at
 *   `/home` (the home page and file shares) and `/plans` (pages) there.
 * - `services.json`: a name, description or `hide` for a route, keyed by
 *   port (`6006`) or port and path (`443/docs`).
 * - `services-status.json`: what the last check found, written by
 *   `discover` every two minutes while the site runs.
 * - `pages/<slug>.html` and `pages/<slug>.json`: shared pages and their
 *   title, source and when and by which session they were shared.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import { frontMatter, renderMarkdown } from "./markdown.ts";

export interface Config {
  publicBase: null | string;
}

/** Where the site is mounted on the tailnet's HTTPS address. */
export const HOME_PATH = "/home";
export const PAGES_PATH = "/plans";

export interface NameEntry {
  description?: string;
  hide?: boolean;
  name?: string;
}

/** One route `tailscale serve` has, and what answered behind it at the last check. */
export interface ServiceStatus {
  backend: null | number;
  checkedAt: string;
  code: null | number;
  folder: null | string;
  key: string;
  kind: string;
  name: string;
  description: null | string;
  hidden: boolean;
  up: boolean;
  url: string;
}

export interface PageMeta {
  session: { cwd: string; id: null | string; name: null | string };
  sharedAt: string;
  slug: string;
  source: string;
  status: null | string;
  title: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const readJson = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
};

/** The share folder's config.json, with defaults. */
export function readConfig(root: string): Config {
  const c = readJson<Partial<Config>>(join(root, "config.json"), {});
  return { publicBase: c.publicBase ? c.publicBase.replace(/\/$/, "") : null };
}

export const readNames = (root: string) =>
  readJson<Record<string, NameEntry>>(join(root, "services.json"), {});

/** Sets a route's name, description or hide flag in services.json, keeping what is there. */
export function writeName(root: string, key: string, entry: NameEntry): void {
  const names = readNames(root);
  names[key] = { ...names[key], ...entry };
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "services.json"),
    `${JSON.stringify(names, null, 2)}\n`,
  );
}

/** A file name or title as a URL slug. */
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "page";

const STYLE = `:root{color-scheme:dark;--ground:#070b14;--panel:#0d1422;--line:#1e2a40;--strong:#2b3a57;--text:#d7e0f0;--muted:#8a98b3;--amber:#f5c26b;--mint:#7fe0b0;--blue:#7db2ff}
body{margin:0;background:var(--ground);color:var(--text);font:15px/1.6 Inter,system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}a{color:var(--blue)}
h1{font:600 26px/1.25 "Chakra Petch",system-ui,sans-serif;margin:0 0 4px}
.section{font:600 13px "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:32px 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border:1px solid var(--strong);border-radius:10px;background:var(--panel);color:inherit;text-decoration:none;min-height:96px}
.card:hover{border-color:var(--amber)}.kind{font:600 11px "IBM Plex Mono",ui-monospace,monospace;color:var(--mint);text-transform:uppercase;letter-spacing:.06em}
.name{font-weight:600;overflow-wrap:anywhere}.desc{color:#a9b6ce;font-size:13px}
.meta{color:var(--muted);font:12px "IBM Plex Mono",ui-monospace,monospace;overflow-wrap:anywhere}
details{margin-top:12px}summary{cursor:pointer;color:#a9b6ce}ul{padding-left:20px}li{margin:4px 0}
article{max-width:860px}article h2{margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:4px}
article h1,article h2,article h3{font-family:"Chakra Petch",system-ui,sans-serif;line-height:1.25}
code{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:1px 4px;font:13px "IBM Plex Mono",ui-monospace,monospace}
pre code{display:block;padding:12px;overflow-x:auto}blockquote{margin:12px 0;padding:4px 16px;border-left:3px solid var(--strong);color:#a9b6ce}
table{border-collapse:collapse;display:block;overflow-x:auto;margin:12px 0}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--panel)}strong{color:var(--amber)}hr{border:0;border-top:1px solid var(--line)}`;

export const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;

/** Renders a Markdown file into the pages folder and returns its record. */
export function addPage(
  file: string,
  root: string,
  session: PageMeta["session"],
  now = new Date(),
  slug?: string,
): PageMeta {
  const text = readFileSync(file, "utf8");
  const { meta, body } = frontMatter(text);
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? basename(file, ".md");
  const record: PageMeta = {
    session,
    sharedAt: now.toISOString(),
    slug: slug ?? slugOf(basename(file)),
    source: file,
    status: meta.status ?? null,
    title,
  };
  const dir = join(root, "pages");
  mkdirSync(dir, { recursive: true });
  const line = `<p class="meta">${esc([record.status ? `Status: ${record.status}` : "", `Shared ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`, session.name ? `by ${session.name}` : ""].filter(Boolean).join(" · "))}</p>`;
  writeFileSync(
    join(dir, `${record.slug}.html`),
    shell(
      title,
      `<p class="meta"><a href="${HOME_PATH}/">Everything shared</a></p><article>${line}${renderMarkdown(body)}</article>`,
    ),
  );
  writeFileSync(
    join(dir, `${record.slug}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

/** Every shared page, newest first. */
export function readPages(root: string): PageMeta[] {
  const dir = join(root, "pages");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<PageMeta | null>(join(dir, f), null))
    .filter(
      (p): p is PageMeta => !!p && existsSync(join(dir, `${p.slug}.html`)),
    )
    .sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
}

/** The routes in `tailscale serve status --json`, as URLs with the local port behind each. */
export function routesFrom(status: {
  TCP?: Record<string, { HTTPS?: boolean }>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
}): Array<{
  backend: null | number;
  key: string;
  path: string;
  port: number;
  url: string;
}> {
  const out: Array<{
    backend: null | number;
    key: string;
    path: string;
    port: number;
    url: string;
  }> = [];
  for (const [hostPort, cfg] of Object.entries(status.Web ?? {})) {
    const host = hostPort.replace(/:\d+$/, "");
    const port = Number(hostPort.split(":").pop());
    const https = !!status.TCP?.[String(port)]?.HTTPS;
    for (const [path, h] of Object.entries(cfg.Handlers ?? {})) {
      const backend = /:(\d+)/.exec(String(h.Proxy ?? ""))?.[1];
      const shownPort =
        (https && port === 443) || (!https && port === 80) ? "" : `:${port}`;
      out.push({
        backend: backend ? Number(backend) : null,
        key: path === "/" ? String(port) : `${port}${path}`,
        path,
        port,
        url: `${https ? "https" : "http"}://${host}${shownPort}${path === "/" ? "/" : `${path}/`}`,
      });
    }
  }
  return out.sort((a, b) => a.port - b.port || a.path.localeCompare(b.path));
}

const kindOf = (title: null | string) =>
  /storybook/i.test(title ?? "")
    ? "Storybook"
    : /grafana/i.test(title ?? "")
      ? "Grafana"
      : "Web";

/**
 * Checks each route and names it: from services.json, else from the page
 * title, else from the folder the server runs in. The share site's own
 * mounts are left out.
 */
export async function discover(
  root: string,
  status: Parameters<typeof routesFrom>[0],
  probe: (
    port: number,
  ) => Promise<{ code: null | number; title: null | string }>,
  folderOf: (port: number) => null | string,
  sitePort: number,
  now = new Date(),
): Promise<ServiceStatus[]> {
  const names = readNames(root);
  const out: ServiceStatus[] = [];
  for (const r of routesFrom(status)) {
    if (r.backend === sitePort) continue;
    const entry = names[r.key] ?? {};
    const p = r.backend ? await probe(r.backend) : { code: null, title: null };
    const folder = r.backend ? folderOf(r.backend) : null;
    const where = folder
      ? folder.replace(/^~\/Repo\//, "").replace(/\/\.worktrees\//, " · ")
      : null;
    const generic =
      !p.title ||
      /error|not found/i.test(p.title) ||
      /^storybook\b/i.test(p.title);
    out.push({
      backend: r.backend,
      checkedAt: now.toISOString(),
      code: p.code,
      description: entry.description ?? null,
      folder: where,
      hidden: !!entry.hide,
      key: r.key,
      kind: kindOf(p.title),
      name: entry.name ?? (generic ? (where ?? `Port ${r.port}`) : p.title!),
      up: p.code !== null && p.code < 400,
      url: r.url,
    });
  }
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "services-status.json"),
    `${JSON.stringify(out, null, 2)}\n`,
  );
  return out;
}

export const readStatus = (root: string) =>
  readJson<ServiceStatus[]>(join(root, "services-status.json"), []);

/** The home page: services that answer, shared pages and file shares as cards, and what is down or hidden. */
export function homePage(
  services: ServiceStatus[],
  pages: PageMeta[],
  shares: Array<{
    id: string;
    title: string;
    sharedAt: string;
    session: { name: null | string };
  }>,
  host: string,
  now = new Date(),
): string {
  const up = services.filter((s) => s.up && !s.hidden);
  const down = services.filter((s) => !s.up && !s.hidden);
  const hidden = services.filter((s) => s.hidden);
  const checked = services[0]?.checkedAt ?? null;
  const card = (href: string, kind: string, name: string, extra: string[]) =>
    `<a class="card" href="${esc(href)}"><span class="kind">${esc(kind)}</span><span class="name">${esc(name)}</span>${extra.join("")}</a>`;
  const serviceCards = up.map((s) =>
    card(s.url, s.kind, s.name, [
      s.description ? `<span class="desc">${esc(s.description)}</span>` : "",
      s.folder ? `<span class="meta">${esc(s.folder)}</span>` : "",
      `<span class="meta">${esc(s.url.replace(/^https?:\/\//, ""))}</span>`,
    ]),
  );
  const pageCards = pages.map((p) =>
    card(`${PAGES_PATH}/${p.slug}.html`, "Page", p.title, [
      `<span class="meta">${esc([p.status ?? "", p.sharedAt.slice(0, 10), p.session.name ?? ""].filter(Boolean).join(" · "))}</span>`,
    ]),
  );
  const shareCards = shares.map((s) =>
    card(`${HOME_PATH}/s/${encodeURIComponent(s.id)}/`, "Files", s.title, [
      `<span class="meta">${esc([s.sharedAt.slice(0, 10), s.session.name ?? ""].filter(Boolean).join(" · "))}</span>`,
    ]),
  );
  const grid = (cards: string[], empty: string) =>
    cards.length
      ? `<div class="grid">${cards.join("")}</div>`
      : `<p class="meta">${esc(empty)}</p>`;
  const list = (items: ServiceStatus[], label: string) =>
    items.length
      ? `<details><summary>${items.length} ${label}</summary><ul>${items.map((s) => `<li><strong>${esc(s.name)}</strong> <span class="meta">${esc(s.url)} → 127.0.0.1:${s.backend ?? "?"}${s.code ? ` (HTTP ${s.code})` : s.hidden ? "" : " (nothing listening)"}</span></li>`).join("")}</ul></details>`
      : "";
  return shell(
    host,
    `<h1>${esc(host)}</h1><p class="meta">What this machine shares on the tailnet.${checked ? ` Services checked ${esc(checked.slice(0, 16).replace("T", " "))} UTC.` : ""} Page built ${esc(now.toISOString().slice(0, 16).replace("T", " "))} UTC.</p>
<h2 class="section">Services</h2>${grid(serviceCards, "No service answers right now.")}
<h2 class="section">Shared pages</h2>${grid(pageCards, "No page is shared.")}
<h2 class="section">Shared files</h2>${grid(shareCards, "No files are shared.")}
${list(down, `route${down.length === 1 ? "" : "s"} not answering`)}${list(hidden, "hidden")}`,
  );
}
