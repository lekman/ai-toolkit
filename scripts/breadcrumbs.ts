/**
 * Write, or check, the breadcrumb line under each documentation page's title.
 *
 * A breadcrumb is one line of links from the repository's front page down to
 * the page's parent, such as `ai-toolkit / Practices / Engineering with
 * Agents`. A folder's README is the parent of the other pages in that folder,
 * and of the README in each folder below it.
 *
 * The line is generated, never typed. Each link's text is the title of the
 * page it points at, so renaming or moving a page would leave every hand-made
 * breadcrumb below it wrong.
 *
 *   bun run breadcrumbs            rewrite every page
 *   bun run breadcrumbs --check    fail if any page is missing one or is stale
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

/** Folders whose pages people read on GitHub, so a way back up is useful. */
const FOLDERS = ["docs", "practices", "privacy", "security"];

/** Folders where only the README pages get one. */
const README_ONLY = ["plugins", "rules", "scripts"];

/**
 * Says whether a page gets a breadcrumb.
 *
 * Left out on purpose: the front page, which has no parent; rule and skill
 * files, which are loaded into an agent's context on every turn; and package
 * READMEs, which are published to a registry where a relative link is broken.
 * @param path the page's path from the repository root, with forward slashes
 * @returns true when the page is in scope
 */
export function inScope(path: string): boolean {
  if (!path.endsWith(".md") || path.endsWith("CHANGELOG.md")) return false;
  const [top, ...rest] = path.split("/");
  if (path === "packages/README.md") return true;
  if (FOLDERS.includes(top as string)) return true;
  if (README_ONLY.includes(top as string)) {
    return rest.at(-1) === "README.md" && rest.length <= 2;
  }
  return false;
}

/**
 * Finds the page one level up from a page.
 * @param path the page's path from the repository root
 * @param exists tells whether a path is a page in the repository
 * @returns the parent's path, or null for the front page
 */
export function parentOf(
  path: string,
  exists: (candidate: string) => boolean,
): null | string {
  if (path === "README.md") return null;
  let dir = posix.dirname(path);
  // A README's parent is above its own folder. Any other page starts with the
  // README beside it.
  if (posix.basename(path) === "README.md") dir = posix.dirname(dir);
  for (;;) {
    const candidate = dir === "." ? "README.md" : `${dir}/README.md`;
    if (exists(candidate)) return candidate;
    if (dir === ".") return null;
    dir = posix.dirname(dir);
  }
}

/**
 * Lists a page's ancestors, from the front page down to its parent.
 * @param path the page's path from the repository root
 * @param exists tells whether a path is a page in the repository
 * @returns the ancestor paths in reading order
 */
export function ancestors(
  path: string,
  exists: (candidate: string) => boolean,
): string[] {
  const chain: string[] = [];
  for (let up = parentOf(path, exists); up; up = parentOf(up, exists)) {
    chain.unshift(up);
  }
  return chain;
}

/**
 * Reads a page's title from its first top-level heading.
 * @param text the page's markdown
 * @returns the title, or an empty string when the page has none
 */
export function titleOf(text: string): string {
  return /^# (.+)$/m.exec(text)?.[1]?.trim() ?? "";
}

/**
 * Builds the breadcrumb line for a page.
 * @param path the page's path from the repository root
 * @param chain the page's ancestors, from the front page down
 * @param title gives the title of an ancestor
 * @returns one line of links joined by slashes
 */
export function render(
  path: string,
  chain: string[],
  title: (ancestor: string) => string,
): string {
  const from = posix.dirname(path);
  return chain
    .map((up) => `[${title(up)}](${posix.relative(from, up)})`)
    .join(" / ");
}

/**
 * Puts the breadcrumb under the page's title, replacing an earlier one.
 *
 * An earlier breadcrumb is known by its shape and not by its words, so it is
 * still found after the front page is renamed.
 * @param text the page's markdown
 * @param crumb the breadcrumb line to place
 * @returns the page with exactly one breadcrumb, under its title
 */
export function apply(text: string, crumb: string): string {
  const lines = text.split("\n");
  const heading = lines.findIndex((line) => line.startsWith("# "));
  if (heading === -1) return text;
  // An earlier breadcrumb is the first line of text under the title, when it
  // has the shape of one: nothing but links, every link pointing at a README,
  // and the first one climbing at least one folder. The shape, and not the
  // words or the exact path, is what is compared, so the old line is still
  // found after a page is renamed or moved. A line of links to other pages
  // is left alone.
  let next = heading + 1;
  while (next < lines.length && lines[next]?.trim() === "") next += 1;
  const line = lines[next] ?? "";
  const onlyLinks = /^\[[^\]]+\]\([^)]+\)( \/ \[[^\]]+\]\([^)]+\))*$/.test(
    line,
  );
  const targets = [...line.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? "");
  const isBreadcrumb =
    onlyLinks &&
    /^(\.\.\/)+README\.md$/.test(targets[0] ?? "") &&
    targets.every((target) => /(^|\/)README\.md$/.test(target));
  if (isBreadcrumb) {
    lines[next] = crumb;
    return lines.join("\n");
  }
  lines.splice(heading + 1, 0, "", crumb);
  return lines.join("\n");
}

if (import.meta.main) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const pages = new Set(
    execFileSync(
      "git",
      // -z: one path per NUL, unquoted. Without it Git quotes and escapes a
      // path with a character outside ASCII, and the page would be skipped.
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "*.md"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\0")
      // The index still lists a page that was deleted and not yet staged.
      // Reading it would throw, so keep only pages that are on disk.
      .filter((path) => path !== "" && existsSync(join(root, path))),
  );
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  const exists = (path: string): boolean => pages.has(path);
  const title = (path: string): string => titleOf(read(path));
  const check = process.argv.includes("--check");

  const stale: string[] = [];
  for (const path of [...pages].filter(inScope).sort()) {
    const before = read(path);
    const crumb = render(path, ancestors(path, exists), title);
    const after = apply(before, crumb);
    if (after === before) continue;
    stale.push(path);
    if (!check) writeFileSync(join(root, path), after);
  }

  if (check && stale.length > 0) {
    console.error(
      [
        ...stale.map(
          (path) => `${path}: the breadcrumb is missing or out of date.`,
        ),
        "",
        "Run 'bun run breadcrumbs' to rewrite them, then commit the result.",
        "",
        "Rule: breadcrumbs",
        "Docs: docs/checks.md#breadcrumbs",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log(
    check
      ? "breadcrumbs: every page is up to date"
      : `breadcrumbs: rewrote ${stale.length} page(s)`,
  );
}
