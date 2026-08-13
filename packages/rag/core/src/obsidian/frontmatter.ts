import type { ParsedNote } from "./types";

/**
 * Minimal YAML-frontmatter parser for the vault's observed conventions:
 * scalar `key: value` pairs and inline lists `key: [a, b]`. Anything more
 * exotic is kept as its raw string. Pure — no I/O.
 */
export class Frontmatter {
  /**
   * Split a markdown document into frontmatter attributes and body. Documents
   * without a leading `---` block return empty attrs and the full body.
   */
  static parse(markdown: string): ParsedNote {
    const match = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
    if (!match || match[1] === undefined) return { attrs: {}, body: markdown };

    const attrs: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line.trim());
      if (!pair || pair[1] === undefined || pair[2] === undefined) continue;
      const value = pair[2].trim();
      const list = /^\[(.*)\]$/.exec(value);
      attrs[pair[1]] =
        list?.[1] !== undefined
          ? list[1]
              .split(",")
              .map((item) => item.trim().replace(/^["']|["']$/g, ""))
              .filter((item) => item.length > 0)
              .join(", ")
          : value.replace(/^["']|["']$/g, "");
    }
    return { attrs, body: markdown.slice(match[0].length) };
  }
}
