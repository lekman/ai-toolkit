/**
 * Parse and validate a video script (YAML).
 *
 * Errors name the path into the script, for example
 * `scenes[1].steps[0].target`, so the writer can find the line to fix.
 */

import { parseDocument } from "yaml";
import { z } from "zod";

import { isAbsoluteUrl } from "./urls.ts";

/** Actions a step can perform on the page. */
export const ACTIONS = [
  "click",
  "type",
  "hover",
  "highlight",
  "scroll",
  "wait",
  "press",
] as const;

/** Actions that cannot run without a target element. */
const NEEDS_TARGET = new Set(["click", "type", "hover", "highlight"]);

const Step = z
  .strictObject({
    do: z.enum(ACTIONS).optional(),
    pause: z.number().min(0).max(120).optional(),
    say: z.string().trim().min(1).optional(),
    target: z.string().trim().min(1).optional(),
    value: z.union([z.string(), z.number()]).optional(),
  })
  .superRefine((step, ctx) => {
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
    if (step.do === "wait" && step.target) {
      ctx.addIssue({
        code: "custom",
        message: "`do: wait` takes no `target`; use `pause` for the length",
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

const Voice = z.strictObject({
  model_id: z.string().default("eleven_multilingual_v2"),
  output_format: z.string().default("mp3_44100_128"),
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

const VideoScript = z
  .strictObject({
    intro: Intro.optional(),
    output: z.string().trim().min(1),
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
  })
  .superRefine((script, ctx) => {
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

/** Parse YAML text and validate it. Throws ScriptError with every problem found. */
export function parseScript(text: string): VideoScript {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new ScriptError(
      doc.errors.map((e) => `YAML: ${e.message.split("\n")[0]}`),
    );
  }
  return validateScript(doc.toJS());
}

/** Validate an already-parsed object. Throws ScriptError with every problem found. */
export function validateScript(data: unknown): VideoScript {
  const result = VideoScript.safeParse(data);
  if (result.success) return result.data;
  throw new ScriptError(
    result.error.issues.map((issue) => {
      const where = formatPath(issue.path);
      if (issue.code === "unrecognized_keys") {
        return `${where}: unknown key ${issue.keys.map((k) => `\`${k}\``).join(", ")}`;
      }
      return `${where}: ${issue.message}`;
    }),
  );
}
