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
   * Convert one line of inline markdown to HTML.
   *
   * Only `http:` and `https:` links become anchors. A vault-relative target
   * (`Clients/Initech/Notes.md`) has nothing to resolve against inside a
   * webview, so its label is rendered as plain text rather than as a link
   * that would do nothing.
   *
   * @param markdown - One task's inline markdown.
   * @returns An HTML fragment.
   */
  static renderInline(markdown: string): string {
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
      (_whole: string, label: string, href: string) =>
        /^https?:\/\//i.test(href)
          ? `<a href="${href}" title="${href}">${label}</a>`
          : label,
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
