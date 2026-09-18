"use strict";

const obsidian = require("obsidian");
const {
  Plugin,
  ItemView,
  Notice,
  MarkdownRenderer,
  PluginSettingTab,
  Setting,
  Menu,
  Modal,
} = obsidian;

const VIEW_TYPE = "dashboard-kanban";

const COLUMNS = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "future", label: "Future" },
  { key: "unscheduled", label: "Unscheduled" },
];

// A view is a subset of the columns. Focus is the default: today and tomorrow
// are the part of the dashboard you can still act on.
const VIEWS = [
  { key: "focus", label: "Focus", columns: ["today", "tomorrow"] },
  { key: "today", label: "Today", columns: ["today"] },
  {
    key: "all",
    label: "All",
    columns: ["today", "tomorrow", "future", "unscheduled"],
  },
];

const DEFAULT_SETTINGS = {
  dashboardPath: "Dashboard.md",
  hideCompleted: true,
  clientOrder: [],
  snapshotDir: "",
  view: "today",
  collapsedClients: [],
  toolkitDir: "",
  bunPath: "",
};

// Archive and Roll shell out to the ai-toolkit scripts rather than repeating
// them here. Those scripts own the write protocol — the iCloud conflict guard
// this plugin does not have — and two implementations of the same dashboard
// edit would drift. The plugin is desktop-only, so spawning is available.
const SCRIPTS = {
  archive: "plugins/planner/scripts/archive-done.ts",
  roll: "plugins/planner/scripts/roll-forward.ts",
};

// One step each. archive-done.ts turns the page itself, so the board no longer
// chains the shift here — doing both would shift twice.
const ACTIONS = {
  archive: [{ script: "archive", flags: [] }],
  roll: [{ script: "roll", flags: [] }],
};

function defaultToolkitDir() {
  const os = require("os");
  const path = require("path");
  return path.join(os.homedir(), "Repo", "ai-toolkit");
}

// `bun` is usually a mise shim, which is not on the PATH Obsidian inherits from
// the macOS launcher. Look for it where it actually lives before giving up.
function resolveBun(settings) {
  if (settings.bunPath) return settings.bunPath;
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const candidates = [
    path.join(os.homedir(), ".local", "share", "mise", "shims", "bun"),
    path.join(os.homedir(), ".bun", "bin", "bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* keep looking */
    }
  }
  return "bun";
}

function runScript(plugin, key, flags = []) {
  return new Promise((resolve) => {
    const { execFile } = require("child_process");
    const path = require("path");
    const dir = plugin.settings.toolkitDir || defaultToolkitDir();
    const script = path.join(dir, SCRIPTS[key]);
    execFile(
      resolveBun(plugin.settings),
      [script, ...flags],
      { cwd: dir, timeout: 60000 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          out: (stdout || "").trim(),
          err: (stderr || String(err || "")).trim(),
        });
      },
    );
  });
}

// Both actions rewrite the day in one go, so the button previews first: the
// scripts' own --dry-run says exactly what would move, and nothing is written
// until that is confirmed.
class ConfirmRunModal extends Modal {
  constructor(app, title, preview, onConfirm) {
    super(app);
    this.title = title;
    this.preview = preview;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.titleEl.setText(this.title);
    const body = this.contentEl.createDiv({ cls: "dk-confirm" });
    for (const line of this.preview)
      body.createDiv({ cls: "dk-confirm-line", text: line });
    const row = this.contentEl.createDiv({ cls: "dk-confirm-actions" });
    const cancel = row.createEl("button", { cls: "dk-btn", text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const go = row.createEl("button", {
      cls: "dk-btn mod-cta",
      text: this.title,
    });
    go.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// data.json may hold a view key this build no longer knows.
function normalizeView(key) {
  return VIEWS.some((v) => v.key === key) ? key : DEFAULT_SETTINGS.view;
}

function viewColumns(key) {
  const view = VIEWS.find((v) => v.key === normalizeView(key)) ?? VIEWS[0];
  return COLUMNS.filter((c) => view.columns.includes(c.key));
}

const NO_CLIENT = "No client";

// Submenus landed in Obsidian 1.5 and the manifest still allows 1.4, so the
// client list falls back to flat menu items where they are missing. Probed on
// a real menu item rather than a prototype, because the runtime `obsidian`
// module does not export every class its typings declare.
let submenuSupport = null;
function menuHasSubmenus() {
  if (submenuSupport === null) {
    submenuSupport = false;
    try {
      new Menu().addItem((i) => {
        submenuSupport = typeof i.setSubmenu === "function";
      });
    } catch {
      submenuSupport = false;
    }
  }
  return submenuSupport;
}

/* ------------------------------------------------------------------ parsing */

// Dashboard.md keeps three bands under `## Focus`: today is unprefixed,
// Tomorrow and Future are collapsed callouts where every line carries "> ".
// Reading strips exactly one "> " level; writing restores it.
function parseDashboard(text) {
  const lines = text.split("\n");
  const items = [];
  const days = { today: [], tomorrow: [], future: [], unscheduled: [] };
  // The intention callout opening a client block, keyed `column|client`.
  const intentions = {};

  let inFocus = false;
  let band = "today";
  let day = null;
  let column = null;
  let client = null;
  let run = null;
  let intent = null;
  let order = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (/^##\s+Focus\s*$/.test(raw)) {
      inFocus = true;
      continue;
    }
    if (!inFocus) continue;
    if (/^##\s+/.test(raw) && !/^##\s+Focus/.test(raw)) break; // ## Initiatives ends Focus

    if (/^>\s*\[!note\]-\s*Tomorrow/.test(raw)) {
      band = "tomorrow";
      day = null;
      client = null;
      run = null;
      intent = null;
      continue;
    }
    if (/^>\s*\[!note\]-\s*Future/.test(raw)) {
      band = "future";
      day = null;
      client = null;
      run = null;
      intent = null;
      continue;
    }

    let line = raw;
    let depth = 0;
    if (band !== "today") {
      if (/^>/.test(raw)) {
        line = raw.replace(/^>\s?/, "");
        depth = 1;
      } else if (raw.trim() === "") {
        // An unprefixed blank line closes the callout.
        band = "today";
        day = null;
        client = null;
        run = null;
        intent = null;
        continue;
      } else {
        band = "today";
        line = raw;
        depth = 0;
      }
    }

    const dayMatch = line.match(/^###\s+(.+?)\s*$/);
    if (dayMatch) {
      day = dayMatch[1];
      client = null;
      run = null;
      intent = null;
      if (band === "today") column = "today";
      else if (band === "tomorrow") column = "tomorrow";
      else column = /unscheduled/i.test(day) ? "unscheduled" : "future";
      if (!days[column].includes(day)) days[column].push(day);
      continue;
    }

    if (day === null && band === "today") continue; // header callouts above the first day

    const clientMatch = line.match(/^####\s+(.+?)\s*$/);
    if (clientMatch) {
      client = clientMatch[1].replace(/^\*\*|\*\*$/g, "").trim();
      run = null;
      intent = null;
      continue;
    }

    // `> [!note] Intention: …` opens a client block and says what the day is
    // for. Keep the first per client per column; a later callout in the same
    // block is a different kind of note.
    const intentMatch = line.match(/^>\s*\[!note\]\s+Intention:\s*(.*)$/i);
    if (intentMatch && column && client) {
      intent = column + "|" + client;
      if (!(intent in intentions)) intentions[intent] = intentMatch[1].trim();
      continue;
    }
    // Continuation lines of that callout, but not the start of another one.
    if (intent && /^>/.test(line)) {
      if (!/^>\s*\[!/.test(line)) {
        const more = line.replace(/^>\s?/, "").trim();
        if (more) intentions[intent] = (intentions[intent] + " " + more).trim();
        continue;
      }
      intent = null;
    }

    // A bold-only paragraph is a run header: it gives the items below it meaning.
    const runMatch = line.match(/^\*\*(.+)\*\*\s*$/);
    if (runMatch && !/^\s*[-*]/.test(line)) {
      run = runMatch[1];
      continue;
    }

    const itemMatch = line.match(/^-\s+\[([ xX])\]\s+(.*)$/);
    if (itemMatch && column) {
      items.push({
        fileLine: i,
        depth,
        band,
        column,
        day,
        client: client || NO_CLIENT,
        run,
        checked: itemMatch[1].toLowerCase() === "x",
        text: itemMatch[2],
        raw,
        order: order++,
      });
    }
  }

  return { lines, items, days, intentions };
}

function itemTitle(text) {
  const bold = text.match(/\*\*(.+?)\*\*/);
  if (bold) return bold[1].replace(/\s*[.:]\s*$/, "");
  const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
  return plain.length > 90 ? plain.slice(0, 90) + "…" : plain;
}

function itemBody(text) {
  const bold = text.match(/\*\*(.+?)\*\*/);
  if (!bold) return "";
  return text
    .slice(text.indexOf(bold[0]) + bold[0].length)
    .replace(/^\s*[.·:]\s*/, "")
    // The Details link is a button in the card's corner, not prose.
    .replace(/\s*·?\s*\[Details\]\([^)]*\)/i, "")
    .trim();
}

// The markers the dashboard uses for status, in the item shape
// `- [ ] [KEY](url) 🔴 **Title.** prose · [Details](path)`.
const STATUS_MARKERS = [
  "🔴",
  "🟡",
  "🟢",
  "⚪",
  "🚧",
  "🧾",
  "💰",
  "📅",
  "⚠️",
  "✅",
  "🔄",
];

/** The status marker, or "" — read from the lead, never from the prose. */
function itemStatus(text) {
  const bold = text.match(/\*\*(.+?)\*\*/);
  const lead = bold ? text.slice(0, text.indexOf(bold[0])) : text;
  for (const m of STATUS_MARKERS) if (lead.includes(m)) return m;
  return "";
}

/** The `[Details](path)` target, or "" — the link text is always "Details". */
function itemDetails(text) {
  const m = text.match(/\[Details\]\(([^)]+)\)/i);
  return m ? m[1].trim() : "";
}

function itemLead(text) {
  // Everything before the first bold run — the ticket link. The status marker
  // is shown in the card's corner instead, so it is taken out here.
  const bold = text.match(/\*\*(.+?)\*\*/);
  let lead = bold ? text.slice(0, text.indexOf(bold[0])) : "";
  for (const m of STATUS_MARKERS) lead = lead.split(m).join("");
  return lead.trim();
}

/* ------------------------------------------------------------------ writing */

async function snapshot(plugin, text) {
  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const dir =
      plugin.settings.snapshotDir ||
      path.join(os.homedir(), ".claude", "dashboard-snapshots");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      path.join(dir, `Dashboard-${stamp}-kanban.md`),
      text,
      "utf8",
    );
  } catch (err) {
    console.warn("dashboard-kanban: snapshot failed", err);
  }
}

// Several agents write this file, so every edit re-reads it and refuses when the
// source line has moved or changed since the board was drawn.
async function editDashboard(plugin, expectLine, expectRaw, mutate) {
  const file = plugin.app.vault.getAbstractFileByPath(
    plugin.settings.dashboardPath,
  );
  if (!file) {
    new Notice("Dashboard not found: " + plugin.settings.dashboardPath);
    return false;
  }
  const text = await plugin.app.vault.read(file);
  const lines = text.split("\n");
  if (expectLine !== null && lines[expectLine] !== expectRaw) {
    new Notice(
      "Dashboard changed underneath the board. Refreshed instead of writing.",
    );
    plugin.refreshViews();
    return false;
  }
  const next = mutate(lines);
  if (!next) return false;
  await snapshot(plugin, text);
  await plugin.app.vault.modify(file, next.join("\n"));
  return true;
}

function prefixFor(column) {
  return column === "today" ? "" : "> ";
}

// Locate the insertion point for a client group inside the target column.
// Returns { index, created } where index is where the item line goes.
function locateInsertPoint(lines, column, client) {
  const pre = prefixFor(column);
  const strip = (l) =>
    pre ? (l.startsWith(">") ? l.replace(/^>\s?/, "") : null) : l;

  let inFocus = false;
  let band = "today";
  let dayStart = -1;
  let dayEnd = -1;
  let curDay = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^##\s+Focus\s*$/.test(raw)) {
      inFocus = true;
      continue;
    }
    if (!inFocus) continue;
    if (/^##\s+/.test(raw) && !/^##\s+Focus/.test(raw)) {
      if (dayStart >= 0 && dayEnd < 0) dayEnd = i;
      break;
    }

    if (/^>\s*\[!note\]-\s*Tomorrow/.test(raw)) {
      if (dayStart >= 0 && dayEnd < 0) dayEnd = i;
      band = "tomorrow";
      continue;
    }
    if (/^>\s*\[!note\]-\s*Future/.test(raw)) {
      if (dayStart >= 0 && dayEnd < 0) dayEnd = i;
      band = "future";
      continue;
    }

    let line = raw;
    if (band !== "today") {
      if (/^>/.test(raw)) line = raw.replace(/^>\s?/, "");
      else if (raw.trim() === "") {
        if (dayStart >= 0 && dayEnd < 0) dayEnd = i;
        band = "today";
        continue;
      } else {
        band = "today";
        line = raw;
      }
    }

    const dayMatch = line.match(/^###\s+(.+?)\s*$/);
    if (dayMatch) {
      if (dayStart >= 0 && dayEnd < 0) dayEnd = i;
      const name = dayMatch[1];
      let col;
      if (band === "today") col = "today";
      else if (band === "tomorrow") col = "tomorrow";
      else col = /unscheduled/i.test(name) ? "unscheduled" : "future";
      if (col === column && dayStart < 0) {
        dayStart = i;
        curDay = name;
      }
    }
  }

  if (dayStart < 0) return null;
  if (dayEnd < 0) dayEnd = lines.length;

  // Items with no `#### **Client**` heading above them sit between the day
  // heading and the first group. Keep them there rather than inventing a group.
  if (client === NO_CLIENT) {
    let end = dayEnd;
    for (let i = dayStart + 1; i < dayEnd; i++) {
      const line = strip(lines[i]);
      if (line !== null && /^####\s+/.test(line)) {
        end = i;
        break;
      }
    }
    let lastOpen = -1;
    for (let i = dayStart + 1; i < end; i++) {
      const line = strip(lines[i]);
      if (line === null) continue;
      const m = line.match(/^-\s+\[([ xX])\]/);
      if (m && m[1].toLowerCase() !== "x") lastOpen = i;
    }
    let insert = lastOpen >= 0 ? lastOpen + 1 : dayStart + 1;
    if (lastOpen < 0)
      while (insert < end && (strip(lines[insert]) || "").trim() === "")
        insert++;
    return { index: insert, createGroup: false, prefix: pre, day: curDay };
  }

  // Find the client group inside that day.
  let groupStart = -1;
  let groupEnd = dayEnd;
  for (let i = dayStart + 1; i < dayEnd; i++) {
    const line = strip(lines[i]);
    if (line === null) continue;
    const m = line.match(/^####\s+(.+?)\s*$/);
    if (!m) continue;
    const name = m[1].replace(/^\*\*|\*\*$/g, "").trim();
    if (groupStart >= 0) {
      groupEnd = i;
      break;
    }
    if (name === client) groupStart = i;
  }

  if (groupStart < 0) {
    // Create the group at the end of the day.
    let end = dayEnd;
    while (end > dayStart + 1 && (strip(lines[end - 1]) || "").trim() === "")
      end--;
    return { index: end, createGroup: true, prefix: pre, day: curDay };
  }

  // Insert after the last open item of the group, before any ticked run.
  let insert;
  let lastOpen = -1;
  for (let i = groupStart + 1; i < groupEnd; i++) {
    const line = strip(lines[i]);
    if (line === null) continue;
    const m = line.match(/^-\s+\[([ xX])\]/);
    if (m && m[1].toLowerCase() !== "x") lastOpen = i;
  }
  if (lastOpen >= 0) insert = lastOpen + 1;
  else {
    let i = groupStart + 1;
    while (i < groupEnd && (strip(lines[i]) || "").trim() === "") i++;
    insert = i;
  }
  return { index: insert, createGroup: false, prefix: pre, day: curDay };
}

/* --------------------------------------------------------------------- view */

class KanbanView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.expanded = new Set();
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Dashboard";
  }
  getIcon() {
    return "layout-dashboard";
  }

  async onOpen() {
    await this.render();
  }
  async onClose() {}

  async render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("dk-root");

    const file = this.app.vault.getAbstractFileByPath(
      this.plugin.settings.dashboardPath,
    );
    if (!file) {
      root.createDiv({
        cls: "dk-empty",
        text: "Dashboard not found: " + this.plugin.settings.dashboardPath,
      });
      return;
    }
    const text = await this.app.vault.read(file);
    const parsed = parseDashboard(text);
    this.parsed = parsed;

    const columns = viewColumns(this.plugin.settings.view);
    const visible = parsed.items.filter((it) =>
      columns.some((c) => c.key === it.column),
    );

    this.renderToolbar(root, visible);

    const board = root.createDiv({ cls: "dk-board" });
    const grid = board.createDiv({ cls: "dk-grid" });
    grid.style.gridTemplateColumns =
      "150px repeat(" + columns.length + ", minmax(240px, 1fr))";

    // Column headers.
    grid.createDiv({ cls: "dk-corner" });
    for (const col of columns) {
      const h = grid.createDiv({ cls: "dk-colhead dk-col-" + col.key });
      h.createSpan({ cls: "dk-colhead-label", text: col.label });
      const sub = parsed.days[col.key];
      if (col.key === "tomorrow" && sub.length)
        h.createSpan({ cls: "dk-colhead-sub", text: sub[0] });
      if (col.key === "today" && sub.length)
        h.createSpan({ cls: "dk-colhead-sub", text: sub[0] });
      if (col.key === "future" && sub.length)
        h.createSpan({
          cls: "dk-colhead-sub",
          text: sub.length + " day" + (sub.length === 1 ? "" : "s"),
        });
    }

    const clients = this.clientRows(visible, columns);
    if (!clients.length) {
      grid.createDiv({
        cls: "dk-empty",
        text: "Nothing under ## Focus in this view.",
      });
      return;
    }

    const collapsed = new Set(this.plugin.settings.collapsedClients || []);

    for (const client of clients) {
      const isCollapsed = collapsed.has(client);
      const label = grid.createDiv({
        cls: "dk-rowhead" + (isCollapsed ? " dk-rowhead-collapsed" : ""),
      });
      label.createSpan({
        cls: "dk-caret",
        text: isCollapsed ? "\u25B8" : "\u25BE",
      });
      label.createSpan({ cls: "dk-rowhead-name", text: client });
      const open = visible.filter(
        (it) => it.client === client && !it.checked,
      ).length;
      label.createSpan({ cls: "dk-rowhead-count", text: String(open) });
      label.setAttribute("aria-expanded", isCollapsed ? "false" : "true");

      // The intention says what the day is for, so it belongs beside the client
      // rather than inside a column. A collapsed row is a count, not a briefing.
      if (!isCollapsed) {
        const intent = this.intentionFor(parsed, columns, client);
        if (intent) {
          const el = label.createDiv({ cls: "dk-rowhead-intent" });
          this.renderMd(el, intent);
        }
      }
      label.addEventListener("click", () => this.toggleClient(client));

      for (const col of columns) {
        const cell = grid.createDiv({
          cls:
            "dk-cell dk-col-" +
            col.key +
            (isCollapsed ? " dk-cell-collapsed" : ""),
        });
        this.wireDrop(cell, col.key, client);
        const cellItems = visible
          .filter((it) => it.client === client && it.column === col.key)
          .filter((it) => !(this.plugin.settings.hideCompleted && it.checked))
          .sort((a, b) =>
            a.checked === b.checked ? a.order - b.order : a.checked ? 1 : -1,
          );

        // A collapsed row keeps its cells so the columns stay aligned and a
        // card can still be dropped into it, but shows a count instead.
        if (isCollapsed) {
          if (cellItems.length)
            cell.createDiv({
              cls: "dk-collapsed-count",
              text: String(cellItems.length),
            });
          continue;
        }

        if (!cellItems.length) {
          cell.addClass("dk-cell-empty");
          continue;
        }

        let lastRun = undefined;
        let lastDay = undefined;
        for (const it of cellItems) {
          if (col.key === "future" && it.day !== lastDay) {
            cell.createDiv({ cls: "dk-daybreak", text: it.day });
            lastDay = it.day;
            lastRun = undefined;
          }
          if (it.run && it.run !== lastRun) {
            const r = cell.createDiv({ cls: "dk-run" });
            this.renderMd(r, it.run);
            lastRun = it.run;
          }
          this.renderCard(cell, it);
        }
      }
    }
  }

  async runAction(button, key) {
    const label = button.textContent;
    const steps = ACTIONS[key];
    const busy = async (fn) => {
      button.disabled = true;
      button.textContent = label + "…";
      const r = await fn();
      button.disabled = false;
      button.textContent = label;
      return r;
    };

    // Preview every step before any of them writes. A later step reads the file
    // an earlier one produced, so its dry run can only describe today's file —
    // the confirm dialog says what is known now, not a simulation of the chain.
    const preview = await busy(async () => {
      const out = [];
      for (const step of steps) {
        const r = await runScript(this.plugin, step.script, [
          ...step.flags,
          "--dry-run",
          "--verbose",
        ]);
        if (!r.ok) return { failed: r };
        if (r.out.startsWith("DRY RUN")) {
          out.push(
            ...r.out
              .split("\n")
              .slice(1)
              .map((l) => l.trim())
              .filter((l) => l && !l.startsWith("snapshot:")),
          );
        } else if (r.out) {
          out.push(r.out);
        }
      }
      return { lines: out };
    });

    if (preview.failed) {
      new Notice(
        label +
          " failed: " +
          (preview.failed.err || "no output").split("\n")[0],
        8000,
      );
      return;
    }
    if (!preview.lines.some((l) => !/^(No |Nothing )/.test(l))) {
      new Notice(preview.lines[0] || "Nothing to do");
      return;
    }

    new ConfirmRunModal(this.app, label, preview.lines, async () => {
      const result = await busy(async () => {
        const said = [];
        for (const step of steps) {
          const r = await runScript(this.plugin, step.script, step.flags);
          if (!r.ok) return { failed: r };
          if (r.out) said.push(r.out);
        }
        return { said };
      });
      if (result.failed) {
        new Notice(
          label +
            " failed: " +
            (result.failed.err || "no output").split("\n")[0],
          8000,
        );
        return;
      }
      new Notice(label + ": " + (result.said.join(" · ") || "done"));
      this.plugin.refreshViews();
    }).open();
  }

  async toggleClient(client) {
    const list = new Set(this.plugin.settings.collapsedClients || []);
    if (list.has(client)) list.delete(client);
    else list.add(client);
    this.plugin.settings.collapsedClients = [...list];
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }

  // Prefer the leftmost visible column, so Focus and Today both show today's.
  intentionFor(parsed, columns, client) {
    for (const col of columns) {
      const found = parsed.intentions[col.key + "|" + client];
      if (found) return found;
    }
    return "";
  }

  clientRows(items, columns) {
    const seen = [];
    const configured = this.plugin.settings.clientOrder || [];
    for (const name of configured)
      if (items.some((i) => i.client === name)) seen.push(name);
    for (const col of columns) {
      for (const it of items) {
        if (it.column !== col.key) continue;
        if (!seen.includes(it.client)) seen.push(it.client);
      }
    }
    return seen;
  }

  // Every client the file knows about, in row order, whatever the current view
  // shows. Moving a task to a client with no group here creates that group.
  clientChoices() {
    const names = [];
    for (const name of this.plugin.settings.clientOrder || []) names.push(name);
    for (const it of (this.parsed && this.parsed.items) || []) {
      if (!names.includes(it.client)) names.push(it.client);
    }
    return names;
  }

  renderMd(el, md) {
    const sourcePath = this.plugin.settings.dashboardPath;
    if (MarkdownRenderer.render)
      MarkdownRenderer.render(this.app, md, el, sourcePath, this);
    else MarkdownRenderer.renderMarkdown(md, el, sourcePath, this);
  }

  renderCard(cell, it) {
    const card = cell.createDiv({
      cls: "dk-card" + (it.checked ? " dk-done" : ""),
    });
    card.draggable = true;
    card.dataset.line = String(it.fileLine);

    card.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData(
        "text/plain",
        JSON.stringify({ line: it.fileLine, raw: it.raw, client: it.client }),
      );
      ev.dataTransfer.effectAllowed = "move";
      card.addClass("dk-dragging");
    });
    card.addEventListener("dragend", () => card.removeClass("dk-dragging"));

    const head = card.createDiv({ cls: "dk-card-head" });
    const box = head.createEl("input", { type: "checkbox", cls: "dk-check" });
    box.checked = it.checked;
    box.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.toggle(it);
    });

    const title = head.createDiv({ cls: "dk-title" });
    this.renderMd(title, itemTitle(it.text));

    // Status and the way into the detail page live in the card's corner. The
    // marker read as noise inside the prose, and the link was not clickable
    // there: the body swallows clicks to expand, and an internal link rendered
    // into a custom view is not wired to the workspace on its own.
    const meta = head.createDiv({ cls: "dk-card-meta" });
    const status = itemStatus(it.text);
    if (status) meta.createSpan({ cls: "dk-status", text: status });
    const details = itemDetails(it.text);
    if (details) {
      const link = meta.createEl("a", { cls: "dk-details", text: "\u2197" });
      link.setAttribute("aria-label", "Open details in a new tab");
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.openDetails(details);
      });
    }

    const lead = itemLead(it.text);
    if (lead) {
      const l = card.createDiv({ cls: "dk-lead" });
      this.renderMd(l, lead);
    }

    const body = itemBody(it.text);
    if (body) {
      const b = card.createDiv({ cls: "dk-body" });
      if (this.expanded.has(it.fileLine)) b.addClass("dk-body-open");
      this.renderMd(b, body);
      b.addEventListener("click", (ev) => {
        if (ev.target.closest("a")) return;
        b.toggleClass("dk-body-open", !b.hasClass("dk-body-open"));
        if (b.hasClass("dk-body-open")) this.expanded.add(it.fileLine);
        else this.expanded.delete(it.fileLine);
      });
    }

    card.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const menu = new Menu();
      menu.addItem((i) =>
        i
          .setTitle("Reveal in Dashboard.md")
          .setIcon("file-text")
          .onClick(() => this.reveal(it)),
      );
      menu.addItem((i) =>
        i
          .setTitle(it.checked ? "Mark as open" : "Mark as done")
          .setIcon("check")
          .onClick(() => this.toggle(it)),
      );
      for (const col of COLUMNS) {
        if (col.key === it.column) continue;
        menu.addItem((i) =>
          i
            .setTitle("Move to " + col.label)
            .setIcon("arrow-right")
            .onClick(() => this.move(it, col.key, it.client)),
        );
      }

      const others = this.clientChoices().filter((name) => name !== it.client);
      if (others.length) {
        menu.addSeparator();
        if (menuHasSubmenus()) {
          menu.addItem((i) => {
            i.setTitle("Move to client").setIcon("users");
            const sub = i.setSubmenu();
            for (const name of others) {
              sub.addItem((s) =>
                s.setTitle(name).onClick(() => this.move(it, it.column, name)),
              );
            }
          });
        } else {
          for (const name of others) {
            menu.addItem((i) =>
              i
                .setTitle("Move to " + name)
                .setIcon("users")
                .onClick(() => this.move(it, it.column, name)),
            );
          }
        }
      }

      menu.showAtMouseEvent(ev);
    });
  }

  wireDrop(cell, column, client) {
    cell.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      cell.addClass("dk-over");
    });
    cell.addEventListener("dragleave", () => cell.removeClass("dk-over"));
    cell.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      cell.removeClass("dk-over");
      let payload;
      try {
        payload = JSON.parse(ev.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }
      const it = (this.parsed.items || []).find(
        (x) => x.fileLine === payload.line,
      );
      if (!it) return;
      if (it.column === column && it.client === client) return;
      await this.move(it, column, client);
    });
  }

  async toggle(it) {
    const next = it.checked ? "[ ]" : "[x]";
    await editDashboard(this.plugin, it.fileLine, it.raw, (lines) => {
      lines[it.fileLine] = lines[it.fileLine].replace(
        /-\s+\[[ xX]\]/,
        "- " + next,
      );
      return lines;
    });
    this.plugin.refreshViews();
  }

  async move(it, column, client) {
    const ok = await editDashboard(
      this.plugin,
      it.fileLine,
      it.raw,
      (lines) => {
        const body = it.raw.replace(/^>\s?/, "");
        lines.splice(it.fileLine, 1);
        const spot = locateInsertPoint(lines, column, client);
        if (!spot) {
          new Notice('No "' + column + '" day found in the dashboard.');
          return null;
        }
        const pre = spot.prefix;
        const block = [];
        if (spot.createGroup) {
          block.push(pre.trimEnd());
          block.push(pre + "#### **" + client + "**");
          block.push(pre.trimEnd());
        }
        block.push(pre + body);
        lines.splice(spot.index, 0, ...block);
        return lines;
      },
    );
    if (ok) new Notice("Moved to " + column + " · " + client);
    this.plugin.refreshViews();
  }

  // `[Details](path)` is vault-relative with percent-encoded spaces, so the
  // stored text is not what openLinkText wants. A new tab is the point: the
  // board stays where it was.
  openDetails(target) {
    if (/^https?:\/\//i.test(target)) {
      window.open(target, "_blank");
      return;
    }
    let path = target;
    try {
      path = decodeURIComponent(target);
    } catch {
      // A malformed escape is better opened verbatim than not at all.
    }
    this.app.workspace.openLinkText(
      path,
      this.plugin.settings.dashboardPath,
      "tab",
    );
  }

  async reveal(it) {
    const file = this.app.vault.getAbstractFileByPath(
      this.plugin.settings.dashboardPath,
    );
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file, { eState: { line: it.fileLine } });
  }

  renderToolbar(root, visible) {
    const bar = root.createDiv({ cls: "dk-toolbar" });
    bar.createDiv({ cls: "dk-toolbar-title", text: "Dashboard" });
    const counts = visible.filter((i) => !i.checked).length;
    bar.createDiv({ cls: "dk-toolbar-count", text: counts + " open" });
    bar.createDiv({ cls: "dk-spacer" });

    const picker = bar.createDiv({ cls: "dk-viewpick" });
    picker.createSpan({ cls: "dk-viewpick-label", text: "View" });
    const select = picker.createEl("select", { cls: "dropdown dk-select" });
    for (const v of VIEWS) {
      const opt = select.createEl("option", { text: v.label });
      opt.value = v.key;
    }
    select.value = normalizeView(this.plugin.settings.view);
    select.addEventListener("change", async () => {
      this.plugin.settings.view = select.value;
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
    });

    const hide = bar.createEl("button", {
      cls: "dk-btn",
      text: this.plugin.settings.hideCompleted ? "Show done" : "Hide done",
    });
    hide.addEventListener("click", async () => {
      this.plugin.settings.hideCompleted = !this.plugin.settings.hideCompleted;
      await this.plugin.saveSettings();
      this.render();
    });

    const archive = bar.createEl("button", { cls: "dk-btn", text: "Archive" });
    archive.addEventListener("click", () => this.runAction(archive, "archive"));

    const roll = bar.createEl("button", { cls: "dk-btn", text: "Roll" });
    roll.addEventListener("click", () => this.runAction(roll, "roll"));

    const refresh = bar.createEl("button", { cls: "dk-btn", text: "Refresh" });
    refresh.addEventListener("click", () => this.render());

    const open = bar.createEl("button", { cls: "dk-btn", text: "Open file" });
    open.addEventListener("click", async () => {
      const file = this.app.vault.getAbstractFileByPath(
        this.plugin.settings.dashboardPath,
      );
      if (file) await this.app.workspace.getLeaf("tab").openFile(file);
    });
  }
}

/* ------------------------------------------------------------------ plugin */

class DashboardKanbanPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new KanbanView(leaf, this));

    this.addRibbonIcon("layout-dashboard", "Dashboard kanban", () =>
      this.activate(),
    );
    this.addCommand({
      id: "open",
      name: "Open dashboard kanban",
      callback: () => this.activate(),
    });

    this.addSettingTab(new KanbanSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === this.settings.dashboardPath) this.refreshViews();
      }),
    );
  }

  onunload() {}

  async activate() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view && leaf.view.render) leaf.view.render();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class KanbanSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Dashboard file")
      .setDesc("Vault-relative path to the dashboard note.")
      .addText((t) =>
        t.setValue(this.plugin.settings.dashboardPath).onChange(async (v) => {
          this.plugin.settings.dashboardPath = v.trim() || "Dashboard.md";
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }),
      );

    new Setting(containerEl)
      .setName("View")
      .setDesc("Which columns the board shows. Focus is today and tomorrow.")
      .addDropdown((d) => {
        for (const v of VIEWS) d.addOption(v.key, v.label);
        d.setValue(normalizeView(this.plugin.settings.view));
        d.onChange(async (v) => {
          this.plugin.settings.view = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        });
      });

    new Setting(containerEl)
      .setName("Client order")
      .setDesc(
        "Comma-separated client names, in the row order you want. Clients not listed follow, in the order they appear in the file.",
      )
      .addText((t) =>
        t
          .setValue((this.plugin.settings.clientOrder || []).join(", "))
          .onChange(async (v) => {
            this.plugin.settings.clientOrder = v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          }),
      );

    new Setting(containerEl)
      .setName("ai-toolkit folder")
      .setDesc(
        "Where the Archive and Roll scripts live. Empty uses ~/Repo/ai-toolkit.",
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.toolkitDir).onChange(async (v) => {
          this.plugin.settings.toolkitDir = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("bun path")
      .setDesc(
        "Absolute path to the bun binary. Empty searches mise, ~/.bun and Homebrew.",
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.bunPath).onChange(async (v) => {
          this.plugin.settings.bunPath = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Snapshot folder")
      .setDesc(
        "Absolute path for a copy of the file taken before every write. Empty uses ~/.claude/dashboard-snapshots.",
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.snapshotDir).onChange(async (v) => {
          this.plugin.settings.snapshotDir = v.trim();
          await this.plugin.saveSettings();
        }),
      );
  }
}

module.exports = DashboardKanbanPlugin;
