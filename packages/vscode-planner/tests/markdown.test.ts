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

const VAULT = "/Users/me/Vault";

describe("Markdown.previewLink", () => {
  test("resolves a vault-relative note to a markdown.showPreview command", () => {
    const link = Markdown.previewLink("Clients/Acme/Notes.md", VAULT);
    expect(link?.path).toBe("/Users/me/Vault/Clients/Acme/Notes.md");
    expect(link?.uri.startsWith("command:markdown.showPreview?")).toBe(true);
  });

  test("undoes the percent-encoding the dashboard writes", () => {
    // Real targets carry spaces and em dashes, e.g.
    // "Acme%20work%20reconciliation%20%E2%80%94%2017%20August%202026.md".
    const link = Markdown.previewLink(
      "Clients/A%20B/Note%20%E2%80%94%20x.md",
      VAULT,
    );
    expect(link?.path).toBe("/Users/me/Vault/Clients/A B/Note — x.md");
  });

  test("refuses a target that climbs out of the vault", () => {
    expect(Markdown.previewLink("../../../.ssh/config.md", VAULT)).toBe(null);
  });

  test("refuses a climb that only nets out inside the vault", () => {
    // Clients/../../etc lands outside even though it starts inside; the walk
    // must fail on the step that pops past the root, not on the final path.
    expect(Markdown.previewLink("Clients/../../etc/passwd.md", VAULT)).toBe(
      null,
    );
  });

  test("refuses an absolute path", () => {
    expect(Markdown.previewLink("/etc/hosts.md", VAULT)).toBe(null);
  });

  test("refuses anything carrying a URL scheme", () => {
    expect(Markdown.previewLink("file:///etc/hosts.md", VAULT)).toBe(null);
    expect(
      Markdown.previewLink("command:workbench.action.terminal.new.md", VAULT),
    ).toBe(null);
  });

  test("refuses a non-markdown target", () => {
    expect(Markdown.previewLink("Clients/Acme/secrets.env", VAULT)).toBe(null);
  });

  test("returns null without a vault root", () => {
    expect(Markdown.previewLink("Clients/Acme/Notes.md")).toBe(null);
    expect(Markdown.previewLink("Clients/Acme/Notes.md", "")).toBe(null);
  });
});

describe("renderInline with a vault root", () => {
  test("[Details] becomes a clickable preview link", () => {
    const html = Markdown.renderInline(
      "Ship it [Details](Clients/Acme/Plan.md)",
      VAULT,
    );
    expect(html).toContain("command:markdown.showPreview?");
    expect(html).toContain(">Details</a>");
  });

  test("the command argument revives as a file Uri, not a string", () => {
    const html = Markdown.renderInline("[D](Clients/Acme/Plan.md)", VAULT);
    const encoded = /command:markdown\.showPreview\?([^"]+)/.exec(html)?.[1];
    const args = JSON.parse(decodeURIComponent(encoded ?? "[]"));
    expect(args[0]).toEqual({
      $mid: 1,
      path: "/Users/me/Vault/Clients/Acme/Plan.md",
      scheme: "file",
    });
  });

  test("without a vault root the label stays plain text", () => {
    // A link that resolves to nothing is worse than no link: it looks
    // clickable and does nothing.
    const html = Markdown.renderInline("[Details](Clients/Acme/Plan.md)");
    expect(html).toBe("Details");
  });

  test("an http link is still an ordinary anchor, not a command", () => {
    const html = Markdown.renderInline(
      "[PR](https://github.com/x/y/pull/1)",
      VAULT,
    );
    expect(html).toContain('href="https://github.com/x/y/pull/1"');
    expect(html).not.toContain("command:");
  });

  test("a traversal target renders as text even with a vault root", () => {
    expect(Markdown.renderInline("[x](../../.ssh/id_rsa.md)", VAULT)).toBe("x");
  });
});

describe("entity decoding cannot double-unescape", () => {
  test("a link whose text is literally &lt; stays literal", () => {
    // escapeHtml turns "&" into "&amp;", so the escaped form of the literal
    // text "&lt;" is "&amp;lt;". Undoing &amp; first fed its own output to
    // the next rule and produced "<" — a character never in the dashboard.
    expect(Markdown.previewLink("Clients/&amp;lt;.md", VAULT)?.path).toBe(
      "/Users/me/Vault/Clients/&lt;.md",
    );
  });

  test("a literal &amp; round-trips to a single ampersand, not further", () => {
    expect(Markdown.previewLink("Clients/a&amp;amp;b.md", VAULT)?.path).toBe(
      "/Users/me/Vault/Clients/a&amp;b.md",
    );
  });

  test("ordinary entities still decode", () => {
    expect(Markdown.previewLink("Clients/a&amp;b.md", VAULT)?.path).toBe(
      "/Users/me/Vault/Clients/a&b.md",
    );
    expect(Markdown.previewLink("Clients/&quot;q&quot;.md", VAULT)?.path).toBe(
      '/Users/me/Vault/Clients/"q".md',
    );
  });

  test("an unknown entity is left alone rather than dropped", () => {
    expect(Markdown.previewLink("Clients/a&nbsp;b.md", VAULT)?.path).toBe(
      "/Users/me/Vault/Clients/a&nbsp;b.md",
    );
  });
});
