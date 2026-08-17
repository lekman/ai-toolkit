/**
 * Inline markdown to HTML, for one task line.
 *
 * Deliberately not a full markdown parser. A task line only ever carries
 * inline constructs - code spans, links, bold, italic, strikethrough - and a
 * general parser would pull in a dependency to render one line.
 *
 * Everything is escaped before any tag is produced, so dashboard text cannot
 * inject markup into the webview.
 */

/**
 * Placeholder delimiter for extracted code spans.
 *
 * U+E000 is a private-use character: it does not occur in dashboard text and
 * survives HTML escaping untouched. A printable marker such as digits between
 * spaces would collide with ordinary prose like "26 merged".
 */
const MARK = "\u{E000}";

/** Renders one line of inline markdown as HTML. */
export class Markdown {
  /**
   * Escape the five characters that can start markup in HTML.
   *
   * @param text - Raw text.
   * @returns Text safe to place in an HTML document.
   */
  static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * A `command:markdown.showPreview` URI for a vault-relative markdown target,
   * or null when the target is not one this should open.
   *
   * The target is percent-encoded in the dashboard because paths carry spaces,
   * and it has already been HTML-escaped by the caller, so both are undone
   * before the path is judged.
   *
   * Refuses anything that leaves the vault. The pane renders text from a file
   * on disk, so a crafted `../../../.ssh/id_rsa` in a task is the obvious way
   * to turn a planning view into a file reader.
   *
   * @param href - Link target as written in the dashboard.
   * @param vaultRoot - Absolute vault path.
   * @returns The command URI and resolved path, or null.
   */
  static previewLink(
    href: string,
    vaultRoot?: string,
  ): { path: string; uri: string } | null {
    if (vaultRoot === undefined || vaultRoot === "") return null;

    const unescaped = href
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    let target: string;
    try {
      target = decodeURIComponent(unescaped);
    } catch {
      return null;
    }

    // Only markdown, and only inside the vault. An absolute path or a URL
    // scheme is not a vault-relative target and is not opened.
    if (!/\.md$/i.test(target)) return null;
    if (target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      return null;
    }

    const segments: string[] = [];
    for (const segment of target.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        if (segments.length === 0) return null;
        segments.pop();
        continue;
      }
      segments.push(segment);
    }
    if (segments.length === 0) return null;

    const path = `${vaultRoot.replace(/\/$/, "")}/${segments.join("/")}`;
    // markdown.showPreview takes a Uri; a file path is passed as a serialised
    // Uri so VS Code revives it rather than treating it as a string.
    const args = encodeURIComponent(
      JSON.stringify([{ $mid: 1, path, scheme: "file" }]),
    );
    return { path, uri: `command:markdown.showPreview?${args}` };
  }

  /**
   * Convert one line of inline markdown to HTML.
   *
   * `http:` and `https:` links become ordinary anchors.
   *
   * A vault-relative target (`Clients/Initech/Notes.md`) becomes a
   * `command:markdown.showPreview` link, which opens the plan in this window's
   * markdown preview. A command URI is used rather than a click handler
   * because the pane's content security policy has no `script-src` at all —
   * adding one to make links work would be a large concession for a small
   * feature.
   *
   * Without `vaultRoot` there is nothing to resolve against, so the label is
   * rendered as plain text rather than as a link that would do nothing.
   *
   * @param markdown - One task's inline markdown.
   * @param vaultRoot - Absolute vault path, for resolving relative targets.
   * @returns An HTML fragment.
   */
  static renderInline(markdown: string, vaultRoot?: string): string {
    // Code spans come out first and go back last: their contents are literal,
    // so no other rule may run inside them.
    const codeSpans: string[] = [];
    const masked = markdown.replace(/`([^`]+)`/g, (_, code: string) => {
      codeSpans.push(code);
      return `${MARK}${codeSpans.length - 1}${MARK}`;
    });

    let html = Markdown.escapeHtml(masked);

    // Runs after escaping, so `href` is already escaped; the http(s) test is
    // what keeps `javascript:` and other schemes out of the document. The
    // target allows one level of nested parentheses, which real URLs carry -
    // `.../wiki/Ruby_(gem)` - and which a plain `[^)]+` would cut short.
    html = html.replace(
      /\[([^\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g,
      (_whole: string, label: string, href: string) => {
        if (/^https?:\/\//i.test(href)) {
          return `<a href="${href}" title="${href}">${label}</a>`;
        }
        const command = Markdown.previewLink(href, vaultRoot);
        return command === null
          ? label
          : `<a href="${command.uri}" title="${Markdown.escapeHtml(command.path)}">${label}</a>`;
      },
    );

    html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

    return html.replace(
      new RegExp(`${MARK}(\\d+)${MARK}`, "g"),
      (_, index: string) =>
        `<code>${Markdown.escapeHtml(codeSpans[Number(index)] ?? "")}</code>`,
    );
  }
}
