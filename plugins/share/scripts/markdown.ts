/**
 * A small Markdown renderer for shared pages, with no dependencies: front
 * matter, headings, paragraphs, lists (one nested level), tables, fenced
 * code, quotes, rules, and inline code, bold, italic and links. Raw HTML in
 * the source is shown as text, never run.
 */

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The front matter's simple `key: value` lines, and the text after it. */
export function frontMatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!] = kv[2]!.trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

/** Inline Markdown in one escaped line: code first, so its contents stay literal. */
export function inline(raw: string): string {
  const codes: string[] = [];
  let s = raw.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  s = escapeHtml(s);
  s = s.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|\/|#|\.\/|\.\.\/)[^)\s]*)\)/g,
    (_, t: string, u: string) => `<a href="${u}">${t}</a>`,
  );
  s = s.replace(
    /&#60;(https?:\/\/[^\s&]+)&#62;/g,
    (_, u: string) => `<a href="${u}">${u}</a>`,
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\uE000(\d+)\uE000/g, (_, i: string) => codes[Number(i)]!);
}

const tableRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/** Markdown to an HTML fragment. */
export function renderMarkdown(text: string): string {
  const lines = frontMatter(text).body.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const isBlank = (l: string | undefined) => l === undefined || !l.trim();
  const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const close = fence[2]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(close))
        body.push(lines[i++]!);
      i++;
      const lang = fence[3]!.trim().split(/\s/)[0];
      out.push(
        `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapeHtml(body.join("\n"))}</code></pre>`,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      const n = heading[1]!.length;
      out.push(`<h${n}>${inline(heading[2]!)}</h${n}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (
      line.trim().startsWith("|") &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(
        lines[i + 1] ?? "",
      )
    ) {
      const head = tableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|"))
        rows.push(tableRow(lines[i++]!));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map(
            (r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table>`,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">"))
        body.push(lines[i++]!.replace(/^>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(body.join("\n"))}</blockquote>`);
      continue;
    }
    const first = listItem.exec(line);
    if (first) {
      const ordered = /\d/.test(first[2]!);
      const baseIndent = first[1]!.length;
      const items: {
        text: string;
        children: { text: string; ordered: boolean }[];
      }[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const m = listItem.exec(l);
        if (m && m[1]!.length <= baseIndent + 1) {
          items.push({ text: m[3]!, children: [] });
          i++;
        } else if (m && items.length) {
          items
            .at(-1)!
            .children.push({ text: m[3]!, ordered: /\d/.test(m[2]!) });
          i++;
        } else if (!isBlank(l) && /^\s+\S/.test(l) && items.length) {
          const target = items.at(-1)!;
          const last = target.children.at(-1);
          if (last && /^\s{4,}/.test(l)) last.text += ` ${l.trim()}`;
          else target.text += ` ${l.trim()}`;
          i++;
        } else if (isBlank(l) && listItem.test(lines[i + 1] ?? "")) {
          i++;
        } else break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(
        `<${tag}>${items
          .map((it) => {
            const sub = it.children.length
              ? `<${it.children[0]!.ordered ? "ol" : "ul"}>${it.children.map((c) => `<li>${inline(c.text)}</li>`).join("")}</${it.children[0]!.ordered ? "ol" : "ul"}>`
              : "";
            return `<li>${inline(it.text)}${sub}</li>`;
          })
          .join("")}</${tag}>`,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^(#{1,6}\s|`{3,}|~{3,}|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]!) &&
      !lines[i]!.trim().startsWith("|")
    )
      para.push(lines[i++]!.trim());
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    else i++;
  }
  return out.join("\n");
}
