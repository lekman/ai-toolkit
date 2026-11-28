import { describe, expect, test } from "bun:test";

import { frontMatter, inline, renderMarkdown } from "./markdown.ts";

describe("frontMatter", () => {
  test("reads simple keys and drops the block", () => {
    const { meta, body } = frontMatter(
      "---\nstatus: draft\ntype: document\n---\n# Title\n",
    );
    expect(meta).toEqual({ status: "draft", type: "document" });
    expect(body).toBe("# Title\n");
  });
  test("leaves text without front matter alone", () => {
    expect(frontMatter("# Title").body).toBe("# Title");
  });
});

describe("inline", () => {
  test("code stays literal, HTML is escaped", () => {
    expect(inline("Run `a <b> **c**` and <script>")).toBe(
      "Run <code>a &#60;b&#62; **c**</code> and &#60;script&#62;",
    );
  });
  test("bold, italic and links", () => {
    expect(inline("**Bold**, *it* and [docs](https://x.test/a)")).toBe(
      '<strong>Bold</strong>, <em>it</em> and <a href="https://x.test/a">docs</a>',
    );
  });
  test("a javascript: link is not made a link", () => {
    expect(inline("[x](javascript:alert(1))")).not.toContain("<a ");
  });
  test("snake_case words are not italic", () => {
    expect(inline("set ASK_HOOK_OFF now")).toBe("set ASK_HOOK_OFF now");
  });
});

describe("renderMarkdown", () => {
  test("headings, paragraphs and a rule", () => {
    expect(renderMarkdown("# One\n\nA line\nwrapped.\n\n---\n\n## Two")).toBe(
      "<h1>One</h1>\n<p>A line wrapped.</p>\n<hr>\n<h2>Two</h2>",
    );
  });
  test("a table with inline formatting", () => {
    const html = renderMarkdown(
      "| Option | Effect |\n| --- | --- |\n| **A** | Uses `x` |",
    );
    expect(html).toBe(
      "<table><thead><tr><th>Option</th><th>Effect</th></tr></thead><tbody><tr><td><strong>A</strong></td><td>Uses <code>x</code></td></tr></tbody></table>",
    );
  });
  test("a fenced block keeps its contents", () => {
    expect(renderMarkdown("```sh\necho '<a>'\n```")).toBe(
      "<pre><code class=\"language-sh\">echo '&#60;a&#62;'</code></pre>",
    );
  });
  test("lists with one nested level and a continued line", () => {
    expect(renderMarkdown("- One\n  - Sub\n- Two\n  continued")).toBe(
      "<ul><li>One<ul><li>Sub</li></ul></li><li>Two continued</li></ul>",
    );
    expect(renderMarkdown("1. First\n2. Second")).toBe(
      "<ol><li>First</li><li>Second</li></ol>",
    );
  });
  test("a quote", () => {
    expect(renderMarkdown("> Said **this**")).toBe(
      "<blockquote><p>Said <strong>this</strong></p></blockquote>",
    );
  });
  test("front matter is not shown", () => {
    expect(renderMarkdown("---\nstatus: x\n---\nText")).toBe("<p>Text</p>");
  });
});
