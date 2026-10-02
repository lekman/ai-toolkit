import { describe, expect, test } from "bun:test";

import { loadScript, parseScript, ScriptError } from "../scripts/script.ts";
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

describe("walkthrough actions", () => {
  const step = (yaml: string): string =>
    minimal.replace("- say: Hello.", `- ${yaml}`);

  test("a drag with from, to and steps is valid", () => {
    const script = parseScript(
      step(
        "{ do: drag, target: '#chart', from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, steps: 30 }",
      ),
    );
    expect(script.scenes[0]?.steps[0]).toEqual({
      do: "drag",
      from: { x: 0.2, y: 0.5 },
      steps: 30,
      target: "#chart",
      to: { x: 0.8, y: 0.5 },
    });
  });

  test("a drag needs a target, from and to", () => {
    expect(problems(step("{ do: drag }"))).toEqual([
      "scenes[0].steps[0].target: `do: drag` needs a `target`",
      "scenes[0].steps[0].from: `do: drag` needs `from` ({ x, y }, fractions of the target from 0 to 1)",
      "scenes[0].steps[0].to: `do: drag` needs `to` ({ x, y }, fractions of the target from 0 to 1)",
    ]);
  });

  test("points are fractions from 0 to 1 with only x and y", () => {
    const list = problems(
      step(
        "{ do: drag, target: c, from: { x: 1.5, y: 0 }, to: { x: 0, y: 0, z: 1 } }",
      ),
    );
    expect(list[0]).toStartWith("scenes[0].steps[0].from.x:");
    expect(list).toContain("scenes[0].steps[0].to: unknown key `z`");
  });

  test("steps is a whole number from 1 to 200", () => {
    expect(
      problems(
        step(
          "{ do: drag, target: c, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, steps: 0 }",
        ),
      )[0],
    ).toStartWith("scenes[0].steps[0].steps:");
    expect(
      problems(step("{ do: wheel, target: c, delta_y: -100, steps: 2.5 }"))[0],
    ).toStartWith("scenes[0].steps[0].steps:");
  });

  test("a wheel needs a delta_y that is not 0", () => {
    expect(problems(step("{ do: wheel, target: c, delta_y: 0 }"))).toEqual([
      "scenes[0].steps[0].delta_y: `do: wheel` needs a `delta_y` that is not 0 (negative scrolls up, which zooms in on most charts)",
    ]);
  });

  test("wheel and dblclick take an optional point", () => {
    const script = parseScript(
      step(
        "{ do: wheel, target: c, at: { x: 0.3, y: 0.6 }, delta_y: -240 }\n      - { do: dblclick, target: c }",
      ),
    );
    expect(script.scenes[0]?.steps[0]?.at).toEqual({ x: 0.3, y: 0.6 });
    expect(script.scenes[0]?.steps[1]?.at).toBeUndefined();
  });

  test("fields for one action are refused on another", () => {
    expect(
      problems(
        step(
          "{ do: click, target: c, from: { x: 0, y: 0 }, delta_y: 5, steps: 3 }",
        ),
      ),
    ).toEqual([
      "scenes[0].steps[0].from: `from` works only with `do: drag`",
      "scenes[0].steps[0].delta_y: `delta_y` works only with `do: wheel`",
      "scenes[0].steps[0].steps: `steps` works only with `do: drag` and `do: wheel`",
    ]);
    expect(
      problems(step("{ do: highlight, target: c, at: { x: 0, y: 0 } }")),
    ).toEqual([
      "scenes[0].steps[0].at: `at` works only with `do: click`, `dblclick`, `hover` and `wheel`",
    ]);
  });

  test("reload takes no target", () => {
    expect(parseScript(step("{ do: reload }")).scenes[0]?.steps[0]).toEqual({
      do: "reload",
    });
    expect(problems(step("{ do: reload, target: x }"))).toEqual([
      "scenes[0].steps[0].target: `do: reload` takes no `target`; it reloads the whole page",
    ]);
  });

  test("frame names the iframe and needs a target", () => {
    const script = parseScript(
      step(`{ do: click, frame: 'iframe[title="Chart"]', target: '#chart' }`),
    );
    expect(script.scenes[0]?.steps[0]?.frame).toBe('iframe[title="Chart"]');
    expect(problems(step(`{ say: Hi., frame: 'iframe' }`))).toEqual([
      "scenes[0].steps[0].frame: `frame` needs a `target` to look for inside the frame",
    ]);
  });

  test("persist_storage defaults to false", () => {
    expect(parseScript(minimal).persist_storage).toBe(false);
    expect(
      parseScript(`${minimal}persist_storage: true
`).persist_storage,
    ).toBe(true);
  });
});

describe("loadScript with include", () => {
  const main = `
title: Tour
output: out/tour.webm
storybook: ./storybook-static
scenes:
  - include: segments/one.yaml
  - title: Middle
    story: b--b
    steps: [{ say: Middle. }]
  - include: segments/two.yaml
`;
  const files = (extra: Record<string, string> = {}) => {
    const all: Record<string, string> = {
      "/v/main.yaml": main,
      "/v/segments/one.yaml":
        "title: One\noutput: one.mp4\nstorybook: ../storybook-static\nscenes:\n  - { title: First, story: a--a, steps: [{ say: First. }] }\n",
      "/v/segments/two.yaml":
        "scenes:\n  - { title: Last, story: c--c, steps: [{ say: Last. }] }\n  - { title: Very last, story: d--d, steps: [{ say: End. }] }\n",
      ...extra,
    };
    return (path: string): string => {
      const text = all[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    };
  };
  const loadProblems = (read: (p: string) => string): string[] => {
    try {
      loadScript("/v/main.yaml", read);
    } catch (error) {
      if (error instanceof ScriptError) return error.problems;
      throw error;
    }
    throw new Error("expected the script to be rejected");
  };

  test("splices the included scenes in order, under the main settings", () => {
    const script = loadScript("/v/main.yaml", files());
    expect(script.scenes.map((s) => s.title)).toEqual([
      "First",
      "Middle",
      "Last",
      "Very last",
    ]);
    expect(script.output).toBe("out/tour.webm");
  });

  test("an error in an included scene names that file and its own index", () => {
    const read = files({
      "/v/segments/two.yaml":
        "scenes:\n  - { story: c--c, steps: [{ say: Ok. }] }\n  - { story: d--d, steps: [{ do: click }] }\n",
    });
    expect(loadProblems(read)).toEqual([
      "segments/two.yaml: scenes[1].steps[0].target: `do: click` needs a `target`",
    ]);
  });

  test("a missing file, a nested include and a different storybook are refused", () => {
    const read = files({
      "/v/main.yaml": main.replace(
        "  - include: segments/two.yaml",
        "  - include: segments/two.yaml\n  - include: nope.yaml",
      ),
      "/v/segments/one.yaml":
        "storybook: http://localhost:6006\nscenes:\n  - include: deeper.yaml\n",
    });
    expect(loadProblems(read)).toEqual([
      "segments/one.yaml: storybook: must be the same as the main script's `storybook`",
      "segments/one.yaml: scenes[0]: an included file cannot include another",
      "scenes[3].include: cannot read /v/nope.yaml",
    ]);
  });

  test("an include entry takes no other key, and needs a file to resolve against", () => {
    expect(
      problems(
        minimal.replace(
          "- story: pages-case--default",
          "- include: a.yaml\n    title: x\n  - story: pages-case--default",
        ),
      ),
    ).toEqual(["scenes[0]: an include entry takes only `include`"]);
    expect(
      problems(
        minimal.replace(
          "- story: pages-case--default",
          "- include: a.yaml\n  - story: pages-case--default",
        ),
      ),
    ).toEqual(["scenes[0].include: works only in a script read from a file"]);
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
