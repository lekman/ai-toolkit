/**
 * Parse and validate a video script (YAML).
 *
 * Errors name the path into the script, for example
 * `scenes[1].steps[0].target`, so the writer can find the line to fix.
 */

import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";

import { isAbsoluteUrl, isServerUrl, withSlash } from "./urls.ts";

/** Actions a step can perform on the page. */
export const ACTIONS = [
  "click",
  "dblclick",
  "drag",
  "highlight",
  "hover",
  "press",
  "reload",
  "scroll",
  "type",
  "wait",
  "wheel",
] as const;

/** Actions that cannot run without a target element. */
const NEEDS_TARGET = new Set([
  "click",
  "dblclick",
  "drag",
  "highlight",
  "hover",
  "type",
  "wheel",
]);
/** Actions that take a point (`at`) inside the target. */
const TAKES_AT = new Set(["click", "dblclick", "hover", "wheel"]);
/** Actions that take a number of moves (`steps`). */
const TAKES_STEPS = new Set(["drag", "wheel"]);

/** A point inside the target's box, as fractions of its width and height. */
const Fraction = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const Step = z
  .strictObject({
    at: Fraction.optional(),
    delta_y: z.number().optional(),
    do: z.enum(ACTIONS).optional(),
    frame: z.string().trim().min(1).optional(),
    from: Fraction.optional(),
    pause: z.number().min(0).max(120).optional(),
    say: z.string().trim().min(1).optional(),
    steps: z.number().int().min(1).max(200).optional(),
    target: z.string().trim().min(1).optional(),
    to: Fraction.optional(),
    value: z.union([z.string(), z.number()]).optional(),
  })
  .superRefine((step, ctx) => {
    const only = (
      key: "at" | "delta_y" | "from" | "steps" | "to",
      allowed: boolean,
      which: string,
    ): void => {
      if (step[key] !== undefined && !allowed) {
        ctx.addIssue({
          code: "custom",
          message: `\`${key}\` works only with ${which}`,
          path: [key],
        });
      }
    };
    if (!step.say && !step.do) {
      ctx.addIssue({
        code: "custom",
        message: "a step needs `say`, `do`, or both",
      });
    }
    if (step.do && NEEDS_TARGET.has(step.do) && !step.target) {
      ctx.addIssue({
        code: "custom",
        message: `\`do: ${step.do}\` needs a \`target\``,
        path: ["target"],
      });
    }
    if (
      (step.do === "type" || step.do === "press") &&
      step.value === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          step.do === "type"
            ? "`do: type` needs a `value` (the text to type)"
            : "`do: press` needs a `value` (a key such as Enter or Tab)",
        path: ["value"],
      });
    }
    if ((step.do === "wait" || step.do === "reload") && step.target) {
      ctx.addIssue({
        code: "custom",
        message:
          step.do === "wait"
            ? "`do: wait` takes no `target`; use `pause` for the length"
            : "`do: reload` takes no `target`; it reloads the whole page",
        path: ["target"],
      });
    }
    if (!step.do && step.target) {
      ctx.addIssue({
        code: "custom",
        message: "`target` has no effect without `do`",
        path: ["target"],
      });
    }
    if (step.frame && !step.target) {
      ctx.addIssue({
        code: "custom",
        message: "`frame` needs a `target` to look for inside the frame",
        path: ["frame"],
      });
    }
    if (step.do === "drag") {
      for (const key of ["from", "to"] as const) {
        if (!step[key]) {
          ctx.addIssue({
            code: "custom",
            message: `\`do: drag\` needs \`${key}\` ({ x, y }, fractions of the target from 0 to 1)`,
            path: [key],
          });
        }
      }
    }
    if (step.do === "wheel" && !step.delta_y) {
      ctx.addIssue({
        code: "custom",
        message:
          "`do: wheel` needs a `delta_y` that is not 0 (negative scrolls up, which zooms in on most charts)",
        path: ["delta_y"],
      });
    }
    only("from", step.do === "drag", "`do: drag`");
    only("to", step.do === "drag", "`do: drag`");
    only("delta_y", step.do === "wheel", "`do: wheel`");
    only(
      "steps",
      Boolean(step.do && TAKES_STEPS.has(step.do)),
      "`do: drag` and `do: wheel`",
    );
    only(
      "at",
      Boolean(step.do && TAKES_AT.has(step.do)),
      "`do: click`, `dblclick`, `hover` and `wheel`",
    );
  });

const Scene = z
  .strictObject({
    steps: z.array(Step).min(1, "a scene needs at least one step"),
    story: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1).optional(),
    wait_for: z.string().trim().min(1).optional(),
  })
  .superRefine((scene, ctx) => {
    if (Boolean(scene.story) === Boolean(scene.url)) {
      ctx.addIssue({
        code: "custom",
        message: "a scene needs exactly one of `story` or `url`",
      });
    }
  });

/** An ElevenLabs pronunciation dictionary: its id and the version to use. */
const PronunciationDictionary = z.strictObject({
  id: z.string().trim().min(1),
  version_id: z.string().trim().min(1),
});

const Voice = z.strictObject({
  model_id: z.string().default("eleven_multilingual_v2"),
  output_format: z.string().default("mp3_44100_128"),
  // ElevenLabs applies at most 3 dictionaries to a request.
  pronunciation_dictionaries: z
    .array(PronunciationDictionary)
    .min(1)
    .max(3)
    .optional(),
  provider: z.literal("elevenlabs"),
  similarity_boost: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.7).max(1.2).optional(),
  stability: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  use_speaker_boost: z.boolean().optional(),
  voice_id: z.string().trim().min(1),
});

/** A CSS colour the intro card can use as is: hex, a name, or rgb()/hsl(). */
const CSS_COLOUR =
  /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\))$/i;

const Intro = z.strictObject({
  background: z
    .string()
    .trim()
    .regex(CSS_COLOUR, "use a hex colour, a colour name, or rgb()/hsl()")
    .default("#ffffff"),
  duration: z.number().min(1).max(15).default(3),
  logo: z.string().trim().min(1),
  subtitle: z.string().trim().min(1).optional(),
});

const ScriptShape = z.strictObject({
  intro: Intro.optional(),
  output: z.string().trim().min(1),
  persist_storage: z.boolean().default(false),
  scenes: z.array(Scene).min(1, "a script needs at least one scene"),
  storybook: z.string().trim().min(1).optional(),
  subtitles: z
    .strictObject({
      burn: z.boolean().default(true),
      max_line: z.number().int().min(20).max(80).default(42),
    })
    .default({ burn: true, max_line: 42 }),
  title: z.string().trim().min(1),
  viewport: z
    .strictObject({
      height: z.number().int().min(240).max(2160),
      width: z.number().int().min(320).max(3840),
    })
    .default({ height: 1080, width: 1920 }),
  voice: Voice.optional(),
});

/**
 * A file named by `include`. It may be a whole script, so it can also be
 * recorded on its own, or hold only `scenes`. Its scenes are checked once
 * they are in the main script.
 */
const SegmentFile = ScriptShape.partial().extend({
  scenes: z
    .array(z.unknown())
    .min(1, "an included file needs at least one scene"),
});

const VideoScript = ScriptShape.superRefine((script, ctx) => {
  script.scenes.forEach((scene, i) => {
    if (scene.story && !script.storybook) {
      ctx.addIssue({
        code: "custom",
        message:
          "a `story` scene needs a top-level `storybook` (URL or folder)",
        path: ["scenes", i, "story"],
      });
    }
    if (scene.url && !isAbsoluteUrl(scene.url) && !script.storybook) {
      ctx.addIssue({
        code: "custom",
        message:
          "a relative `url` needs a top-level `storybook` (URL or folder) to resolve against",
        path: ["scenes", i, "url"],
      });
    }
  });
});

/** A validated script, with defaults applied. */
export type VideoScript = z.infer<typeof VideoScript>;
/** One scene of a validated script. */
export type Scene = VideoScript["scenes"][number];
/** One step of a validated scene. */
export type Step = Scene["steps"][number];
/** Intro card settings of a validated script. */
export type IntroConfig = NonNullable<VideoScript["intro"]>;
/** Voice settings of a validated script. */
export type VoiceConfig = NonNullable<VideoScript["voice"]>;

/** Raised when a script cannot be parsed or fails validation. */
export class ScriptError extends Error {
  /** One line per problem, each naming its path in the script. */
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `The script is not valid:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "ScriptError";
    this.problems = problems;
  }
}

/** Render a zod issue path as `scenes[1].steps[0].target`. */
function formatPath(path: PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out || "(top level)";
}

/** Where a scene of the merged script was written: a file it was included from, and its index there. */
interface Origin {
  file?: string;
  index: number;
}

/** One line per zod issue. A scene from an included file is named by that file and its own index. */
function describeIssues(error: z.ZodError, origins?: Origin[]): string[] {
  return error.issues.map((issue) => {
    let path = issue.path;
    let prefix = "";
    const origin =
      path[0] === "scenes" && typeof path[1] === "number"
        ? origins?.[path[1]]
        : undefined;
    if (origin?.file) {
      prefix = `${origin.file}: `;
      path = ["scenes", origin.index, ...path.slice(2)];
    }
    const where = prefix + formatPath(path);
    if (issue.code === "unrecognized_keys") {
      return `${where}: unknown key ${issue.keys.map((k) => `\`${k}\``).join(", ")}`;
    }
    return `${where}: ${issue.message}`;
  });
}

/** Parse YAML text into plain data. Throws ScriptError on a syntax error. */
function parseYaml(text: string, label = ""): unknown {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new ScriptError(
      doc.errors.map((e) => `${label}YAML: ${e.message.split("\n")[0]}`),
    );
  }
  return doc.toJS();
}

/** Parse YAML text and validate it. Throws ScriptError with every problem found. */
export function parseScript(text: string): VideoScript {
  const data = parseYaml(text);
  return validateScript(expandIncludes(data, undefined).data);
}

/** Validate an already-parsed object. Throws ScriptError with every problem found. */
export function validateScript(data: unknown, origins?: Origin[]): VideoScript {
  const result = VideoScript.safeParse(data);
  if (result.success) return result.data;
  throw new ScriptError(describeIssues(result.error, origins));
}

/** Reads a text file. The CLI passes readFileSync; tests pass a lookup. */
export type ReadText = (path: string) => string;

/**
 * Read a script file and the files its `include` entries name, and validate
 * the whole as one script. Paths in an include are relative to the script.
 */
export function loadScript(path: string, read: ReadText): VideoScript {
  const data = parseYaml(read(path));
  const { data: merged, origins } = expandIncludes(data, {
    dir: dirname(resolve(path)),
    read,
  });
  return validateScript(merged, origins);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `storybook` value in a form two files can compare: a URL, or an absolute folder. */
function storybookBase(value: string, dir: string): string {
  return isServerUrl(value) ? withSlash(value) : resolve(dir, value);
}

/**
 * Replace each `{ include: file }` entry in `scenes` with the scenes of that
 * file. An included file cannot include another, and a `storybook` it sets
 * must be the main script's, because every scene is served from one place.
 */
function expandIncludes(
  data: unknown,
  files: undefined | { dir: string; read: ReadText },
): { data: unknown; origins: Origin[] } {
  if (!isRecord(data) || !Array.isArray(data.scenes)) {
    return { data, origins: [] };
  }
  const problems: string[] = [];
  const scenes: unknown[] = [];
  const origins: Origin[] = [];
  const mainBase =
    typeof data.storybook === "string" && files
      ? storybookBase(data.storybook, files.dir)
      : undefined;
  data.scenes.forEach((entry: unknown, i: number) => {
    if (!isRecord(entry) || !("include" in entry)) {
      scenes.push(entry);
      origins.push({ index: i });
      return;
    }
    const where = `scenes[${i}]`;
    const file = entry.include;
    if (Object.keys(entry).length > 1) {
      problems.push(`${where}: an include entry takes only \`include\``);
      return;
    }
    if (typeof file !== "string" || !file.trim()) {
      problems.push(`${where}.include: name a YAML file`);
      return;
    }
    if (!files) {
      problems.push(
        `${where}.include: works only in a script read from a file`,
      );
      return;
    }
    const path = resolve(files.dir, file);
    let text: string;
    try {
      text = files.read(path);
    } catch {
      problems.push(`${where}.include: cannot read ${path}`);
      return;
    }
    let segment: unknown;
    try {
      segment = parseYaml(text, `${file}: `);
    } catch (error) {
      if (error instanceof ScriptError) problems.push(...error.problems);
      else throw error;
      return;
    }
    const checked = SegmentFile.safeParse(segment);
    if (!checked.success) {
      problems.push(
        ...describeIssues(checked.error).map((p) => `${file}: ${p}`),
      );
      return;
    }
    const own = checked.data.storybook;
    if (own && storybookBase(own, dirname(path)) !== mainBase) {
      problems.push(
        `${file}: storybook: must be the same as the main script's \`storybook\``,
      );
    }
    checked.data.scenes.forEach((scene, j) => {
      if (isRecord(scene) && "include" in scene) {
        problems.push(
          `${file}: scenes[${j}]: an included file cannot include another`,
        );
        return;
      }
      scenes.push(scene);
      origins.push({ file, index: j });
    });
  });
  if (problems.length > 0) throw new ScriptError(problems);
  return { data: { ...data, scenes }, origins };
}
