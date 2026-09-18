import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Load the plugin outside Obsidian.
 *
 * `main.js` is CommonJS that Obsidian loads and that requires the `obsidian`
 * module the host injects. Stub that, re-export the internals under test, and
 * write it as `.cjs` so it stays CommonJS inside this ESM package.
 *
 * A new export destructured at the top of main.js has to be added to the stub
 * too, or every test fails at load with "Class extends value undefined".
 */
const EXPORTS = [
  "parseDashboard",
  "locateInsertPoint",
  "itemTitle",
  "itemBody",
  "itemLead",
  "itemStatus",
  "itemDetails",
  "STATUS_MARKERS",
  "VIEWS",
  "COLUMNS",
  "ACTIONS",
  "SCRIPTS",
  "viewColumns",
  "normalizeView",
  "defaultToolkitDir",
  "resolveBun",
  "runScript",
  "KanbanView",
  "DEFAULT_SETTINGS",
  "NO_CLIENT",
];

let seq = 0;

const require_ = createRequire(import.meta.url);
const Module = require_("node:module");

/**
 * The stub the next `require("child_process")` will get.
 *
 * `runScript` resolves child_process lazily, at click time rather than at load
 * time, so a hook installed only while main.js is being required is gone by
 * the time a test calls it — and the test then spawns the real bun against the
 * real vault. It did, and it rolled a live dashboard forward. So the hook is
 * installed once and never removed, and the default refuses to spawn: a test
 * that wants a spawn has to say so.
 */
let childProcessStub: unknown = refuseToSpawn();

function refuseToSpawn() {
  return {
    execFile: (
      _bin: string,
      _argv: string[],
      _opts: unknown,
      cb: (e: Error, out: string, err: string) => void,
    ) => cb(new Error("child_process is not stubbed in this test"), "", ""),
  };
}

const original = Module.prototype.require;
Module.prototype.require = function (
  this: unknown,
  id: string,
  ...rest: unknown[]
) {
  if (id === "obsidian") return obsidianStub();
  if (id === "child_process" || id === "node:child_process")
    return childProcessStub;
  return original.call(this, id, ...rest);
};

/** @param childProcess a stub for the module the action buttons spawn with. */
export function loadPlugin(childProcess?: unknown) {
  childProcessStub = childProcess ?? refuseToSpawn();
  const src = readFileSync(join(import.meta.dir, "..", "main.js"), "utf8");
  const exposed = src.replace(
    "module.exports = DashboardKanbanPlugin;",
    `module.exports = { DashboardKanbanPlugin, ${EXPORTS.join(", ")} };`,
  );
  // mkdtemp, not a name built from the pid: the temp dir is shared and
  // writable by anyone on the machine, and this file is require'd, so a
  // predictable path is a symlink away from executing someone else's code.
  // mkdtemp returns a fresh directory only this process can write.
  const dir = mkdtempSync(join(tmpdir(), "dk-"));
  const path = join(dir, `main-${seq++}.cjs`);
  writeFileSync(path, exposed, "utf8");
  return require_(path);
}

/** Only the surface main.js destructures; each is a class it may extend. */
function obsidianStub() {
  class Base {}
  return {
    Plugin: Base,
    ItemView: Base,
    Notice: Base,
    MarkdownRenderer: {},
    PluginSettingTab: Base,
    Setting: Base,
    Menu: class {
      addItem() {
        return this;
      }
    },
    Modal: Base,
  };
}

/**
 * A dashboard in the documented shape: today unprefixed, exactly one day in
 * Tomorrow, later days in Future. Client names are placeholders — this repo is
 * public and must not carry a real engagement's.
 */
export const FIXTURE = `# Dashboard

## Focus

> [!note]- How to maintain this Focus log (for editors)
>
> Prose that must never move.

### Wednesday 16 September

#### **Acme**

> [!note] Intention: three things and nothing else.

- [x] Done thing
- [ ] **First open thing** · with a body
- [ ] 🧾 Admin thing

#### **Globex**

- [ ] Globex open thing

> [!note]- Tomorrow
>
> ### Thursday 17 September
>
> #### **Acme**
>
> - [ ] Already planned for tomorrow

> [!note]- Future
>
> ### Friday 18 September
>
> #### **Umbrella**
>
> - [ ] Friday thing
>
> ### Unscheduled — no day assigned
>
> #### **Initech**
>
> - [ ] Someday thing

## Initiatives

Untouched.
`;
