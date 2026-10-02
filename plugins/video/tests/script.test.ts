import { describe, expect, test } from "bun:test";

import { parseScript, ScriptError } from "../scripts/script.ts";
import { sceneUrl } from "../scripts/urls.ts";

const minimal = `
title: Demo
output: out/demo.mp4
storybook: http://localhost:6006
scenes:
  - story: pages-case--default
    steps:
      - say: Hello.
`;

function problems(yaml: string): string[] {
  try {
    parseScript(yaml);
  } catch (error) {
    if (error instanceof ScriptError) return error.problems;
    throw error;
  }
  throw new Error("expected the script to be rejected");
}

describe("parseScript", () => {
  test("applies defaults to a minimal script", () => {
    const script = parseScript(minimal);
    expect(script.viewport).toEqual({ height: 1080, width: 1920 });
    expect(script.subtitles).toEqual({ burn: true, max_line: 42 });
    expect(script.voice).toBeUndefined();
  });

  test("fills voice defaults", () => {
    const script = parseScript(
      `${minimal}voice: { provider: elevenlabs, voice_id: abc }\n`,
    );
    expect(script.voice?.model_id).toBe("eleven_multilingual_v2");
    expect(script.voice?.output_format).toBe("mp3_44100_128");
  });

  test("names the path of a step with no say and no do", () => {
    expect(problems(minimal.replace("- say: Hello.", "- pause: 1"))).toEqual([
      "scenes[0].steps[0]: a step needs `say`, `do`, or both",
    ]);
  });

  test("click without a target", () => {
    expect(problems(minimal.replace("- say: Hello.", "- do: click"))).toEqual([
      "scenes[0].steps[0].target: `do: click` needs a `target`",
    ]);
  });

  test("type and press need a value", () => {
    const yaml = minimal.replace(
      "- say: Hello.",
      "- { do: type, target: '#q' }\n      - { do: press }",
    );
    expect(problems(yaml)).toEqual([
      "scenes[0].steps[0].value: `do: type` needs a `value` (the text to type)",
      "scenes[0].steps[1].value: `do: press` needs a `value` (a key such as Enter or Tab)",
    ]);
  });

  test("an unknown action lists the allowed ones", () => {
    const [p] = problems(
      minimal.replace("- say: Hello.", "- { do: tap, target: x }"),
    );
    expect(p).toStartWith("scenes[0].steps[0].do:");
    expect(p).toContain("click");
  });

  test("a typo in a key is reported, not ignored", () => {
    expect(
      problems(minimal.replace("- say: Hello.", "- { do: click, tagret: x }")),
    ).toContain("scenes[0].steps[0]: unknown key `tagret`");
  });

  test("a scene needs exactly one of story or url", () => {
    expect(
      problems(
        minimal.replace(
          "- story: pages-case--default",
          "- story: a\n    url: b",
        ),
      ),
    ).toEqual(["scenes[0]: a scene needs exactly one of `story` or `url`"]);
  });

  test("a story without a storybook base", () => {
    expect(
      problems(minimal.replace("storybook: http://localhost:6006\n", "")),
    ).toEqual([
      "scenes[0].story: a `story` scene needs a top-level `storybook` (URL or folder)",
    ]);
  });

  test("a relative url without a storybook base", () => {
    const yaml = minimal
      .replace("storybook: http://localhost:6006\n", "")
      .replace("story: pages-case--default", "url: form.html");
    expect(problems(yaml)[0]).toStartWith("scenes[0].url: a relative `url`");
  });

  test("an intro gets a 3 second default and a white background", () => {
    const script = parseScript(`${minimal}intro: { logo: brand/logo.svg }\n`);
    expect(script.intro).toEqual({
      background: "#ffffff",
      duration: 3,
      logo: "brand/logo.svg",
    });
  });

  test("an intro needs a logo and refuses CSS that is not a colour", () => {
    expect(problems(`${minimal}intro: { duration: 3 }\n`)[0]).toStartWith(
      "intro.logo:",
    );
    expect(
      problems(
        `${minimal}intro: { logo: l.svg, background: "red; display: none" }\n`,
      ),
    ).toEqual([
      "intro.background: use a hex colour, a colour name, or rgb()/hsl()",
    ]);
  });

  test("YAML syntax errors are reported as such", () => {
    const [p] = problems("title: [unclosed\n");
    expect(p).toStartWith("YAML:");
  });

  test("missing title and output", () => {
    const list = problems("scenes: []\n");
    expect(list.some((p) => p.startsWith("title:"))).toBe(true);
    expect(list.some((p) => p.startsWith("output:"))).toBe(true);
    expect(list.some((p) => p.startsWith("scenes:"))).toBe(true);
  });
});

describe("sceneUrl", () => {
  const scene = (extra: object) =>
    ({ steps: [{ say: "x" }], ...extra }) as never;

  test("a story opens the iframe view", () => {
    expect(
      sceneUrl(
        scene({ story: "pages-kpi--sample-data" }),
        "http://localhost:6006",
      ),
    ).toBe(
      "http://localhost:6006/iframe.html?id=pages-kpi--sample-data&viewMode=story",
    );
  });

  test("a relative url resolves under the base", () => {
    expect(
      sceneUrl(scene({ url: "form.html" }), "http://127.0.0.1:5000/"),
    ).toBe("http://127.0.0.1:5000/form.html");
  });

  test("an absolute url is used as is", () => {
    expect(sceneUrl(scene({ url: "https://example.com/a" }), undefined)).toBe(
      "https://example.com/a",
    );
  });
});
