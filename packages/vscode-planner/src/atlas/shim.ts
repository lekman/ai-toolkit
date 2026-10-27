/**
 * The stand-in for the artifact runtime, as a script for the webview.
 *
 * It defines `window.claude.use`, which the Atlas page calls for `mcp` and
 * `db`, and forwards each call to the extension with `postMessage`. The
 * extension answers with `atlas:reply`, and announces store writes with
 * `atlas:doc` so every snapshot listener sees them.
 *
 * Only the calls the page makes are provided: `mcp.callTool`,
 * `mcp.watchTool`, and `db.doc(path)` with `get`, `set`, `delete` and
 * `onSnapshot`.
 */

const SOURCE = String.raw`(() => {
  "use strict";
  const FOCUS = __FOCUS__;
  if (FOCUS) { try { localStorage.setItem("db.focus", FOCUS); } catch (e) {} }

  const host = acquireVsCodeApi();
  const pending = new Map();
  const listeners = new Map();
  let next = 0;

  const copy = (data) => (data === undefined || data === null ? null : JSON.parse(JSON.stringify(data)));
  const snap = (path, data) => ({ id: path, exists: data !== undefined && data !== null, data: () => copy(data) });
  const notify = (path, data) => {
    const set = listeners.get(path);
    if (!set) return;
    for (const fn of [...set]) { try { fn(snap(path, data)); } catch (e) {} }
  };

  window.addEventListener("message", (event) => {
    const m = event.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "atlas:reply") {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.ok(m.result); else p.fail(m.error || { code: "upstream_error" });
    } else if (m.type === "atlas:doc" && typeof m.path === "string") {
      notify(m.path, m.data);
    }
  });

  const ask = (kind, body) => new Promise((ok, fail) => {
    const id = ++next;
    pending.set(id, { ok, fail });
    host.postMessage({ type: "atlas", id, kind, ...body });
  });

  const STOP = new Set(["not_granted", "not_in_manifest"]);
  const mcp = {
    callTool: (server, tool, args) => ask("callTool", { server, tool, args: args || {} }),
    watchTool(server, tool, args, onEvent, options) {
      const every = options && options.refetchInterval;
      let stopped = false;
      let timer = null;
      const run = () => mcp.callTool(server, tool, args).then(
        (result) => { if (!stopped) onEvent({ type: "data", result }); return true; },
        (error) => { if (!stopped) onEvent({ type: "error", error }); return !(error && STOP.has(error.code)); },
      ).then((again) => { if (!stopped && again && every) timer = setTimeout(run, every); });
      run();
      return () => { stopped = true; if (timer) clearTimeout(timer); };
    },
  };

  const db = {
    doc(path) {
      return {
        get: () => ask("dbGet", { path }).then((data) => snap(path, data)),
        set: (data) => ask("dbSet", { path, data: copy(data) }),
        delete: () => ask("dbDelete", { path }),
        onSnapshot(onNext, onError) {
          let set = listeners.get(path);
          if (!set) listeners.set(path, (set = new Set()));
          set.add(onNext);
          ask("dbGet", { path }).then(
            (data) => { if (set.has(onNext)) onNext(snap(path, data)); },
            (error) => { if (onError) onError(error); },
          );
          return () => { set.delete(onNext); };
        },
      };
    },
  };

  window.claude = {
    use: (name) => name === "mcp" ? Promise.resolve(mcp)
      : name === "db" ? Promise.resolve(db)
      : Promise.reject({ code: "not_granted", message: name + " is not available in VS Code." }),
  };
})();`;

/** Builds the runtime stand-in script. */
export class Shim {
  /**
   * The script, with the client to open on filled in.
   *
   * @param focus - The page's client key, or null to leave the page's own choice.
   * @returns JavaScript source for an inline script tag.
   */
  static script(focus: null | string): string {
    // JSON is valid JavaScript; escaping `<` keeps a `</script>` in the value
    // from closing the tag.
    const literal = JSON.stringify(focus).replace(/</g, "\\u003c");
    return SOURCE.replace("__FOCUS__", literal);
  }
}
