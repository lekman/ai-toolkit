import { describe, expect, test } from "bun:test";

import {
  escapeHtml,
  INTRO_FADE_MS,
  introHtml,
  logoDataUri,
  logoMime,
  textColour,
} from "../scripts/intro.ts";
import { parseScript } from "../scripts/script.ts";
import { toTranscript } from "../scripts/transcript.ts";

describe("introHtml", () => {
  const html = introHtml({
    background: "#0b1f3a",
    durationMs: 3000,
    logoSrc: "data:image/svg+xml;base64,AAAA",
    subtitle: "For clinicians",
    title: "Reviewing <a> case & more",
  });

  test("shows the logo, the escaped title and the subtitle", () => {
    expect(html).toContain(
      '<img class="logo" alt="" src="data:image/svg+xml;base64,AAAA">',
    );
    expect(html).toContain("<h1>Reviewing &lt;a&gt; case &amp; more</h1>");
    expect(html).toContain('<p class="subtitle">For clinicians</p>');
  });

  test("fades in, then fades out so it ends at the duration", () => {
    expect(html).toContain(
      `sbv-out ${INTRO_FADE_MS}ms ease-in ${3000 - INTRO_FADE_MS}ms`,
    );
  });

  test("uses white text on a dark background", () => {
    expect(html).toContain("color: #ffffff");
  });

  test("leaves the subtitle out when there is none", () => {
    const plain = introHtml({
      background: "#fff",
      durationMs: 3000,
      logoSrc: "x.svg",
      title: "T",
    });
    expect(plain).not.toContain('subtitle">');
  });
});

describe("textColour", () => {
  test("dark text on light, white text on dark", () => {
    expect(textColour("#ffffff")).toBe("#111111");
    expect(textColour("#fff")).toBe("#111111");
    expect(textColour("#111827")).toBe("#ffffff");
    expect(textColour("white")).toBe("#111111");
  });
});

describe("logo helpers", () => {
  test("knows the image types the card shows", () => {
    expect(logoMime(".SVG")).toBe("image/svg+xml");
    expect(logoMime(".png")).toBe("image/png");
    expect(logoMime(".pdf")).toBeUndefined();
  });
  test("builds a base64 data URI", () => {
    expect(
      logoDataUri(new TextEncoder().encode("<svg/>"), "image/svg+xml"),
    ).toBe("data:image/svg+xml;base64,PHN2Zy8+");
  });
  test("escapes quotes for attributes", () => {
    expect(escapeHtml(`a"b'c`)).toBe("a&quot;b&#39;c");
  });
});

describe("toTranscript", () => {
  const script = parseScript(`
title: Tour
output: o.mp4
storybook: ./sb
scenes:
  - title: First
    story: a--b
    steps: [{ say: One. }, { do: wait }]
  - story: c--d
    steps: [{ do: wait }]
`);

  test("lists the spoken lines under one heading per scene", () => {
    expect(toTranscript(script)).toBe(
      "# Tour\n\n## 1. First\n\n1. One.\n\n## 2. c--d\n\n_No narration in this scene._\n",
    );
  });

  test("adds the scene start times when given, already shifted by any intro", () => {
    const text = toTranscript(script, [3000, 9500]);
    expect(text).toContain("## 1. First [0:03.0]");
    expect(text).toContain("## 2. c--d [0:09.5]");
  });
});
