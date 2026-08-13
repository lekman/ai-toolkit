import { describe, expect, test } from "bun:test";

import { Markdown } from "../src/dashboard/markdown.ts";

describe("escapeHtml", () => {
  test("escapes the characters that can open a tag", () => {
    expect(Markdown.escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });
});

describe("renderInline", () => {
  test("renders bold, italic and strikethrough", () => {
    expect(Markdown.renderInline("**a** *b* ~~c~~")).toBe(
      "<strong>a</strong> <em>b</em> <s>c</s>",
    );
  });

  test("renders code spans without interpreting them", () => {
    expect(Markdown.renderInline("set `a **b** c`")).toBe(
      "set <code>a **b** c</code>",
    );
  });

  test("escapes markup inside a code span", () => {
    expect(Markdown.renderInline("`<script>`")).toBe(
      "<code>&lt;script&gt;</code>",
    );
  });

  test("does not mistake ordinary digits for a code placeholder", () => {
    expect(Markdown.renderInline("26 merged, 3 open")).toBe(
      "26 merged, 3 open",
    );
  });

  test("links http and https targets", () => {
    expect(Markdown.renderInline("[PR](https://example.com/1)")).toBe(
      '<a href="https://example.com/1" title="https://example.com/1">PR</a>',
    );
  });

  test("renders a vault-relative link as plain text", () => {
    expect(Markdown.renderInline("[Details](Clients/Initech/Note.md)")).toBe(
      "Details",
    );
  });

  test("drops a javascript: link rather than rendering an anchor", () => {
    const html = Markdown.renderInline("[x](javascript:alert(1))");
    expect(html).not.toContain("<a");
    expect(html).toBe("x");
  });

  test("escapes raw HTML in the task text", () => {
    expect(Markdown.renderInline('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  test("leaves a bare asterisk alone", () => {
    expect(Markdown.renderInline("2 * 3 = 6")).toBe("2 * 3 = 6");
  });
});
