/**
 * The timing plan: how long each step stays on screen, before anything is
 * recorded.
 *
 * A step lasts the longest of three things: its voice clip plus a short gap,
 * the time a viewer needs to read its caption, and the `pause` the script
 * asks for. The recorder holds each step at least this long; a slow page can
 * make a step run longer, and the recorded times are what the subtitles and
 * the audio follow.
 */

import type { Scene, VideoScript } from "./script.ts";

/** Reading speed for captions, in characters per second. */
export const READING_CPS = 15;
/** Shortest time a caption stays up, in ms. */
export const MIN_READ_MS = 1500;
/** Silence after a voice clip before the next step starts, in ms. */
export const VOICE_GAP_MS = 400;
/** Shortest step, for steps with no caption and no pause, in ms. */
export const MIN_STEP_MS = 800;
/** Time each scene is shown before its first step, in ms. */
export const SCENE_LEAD_MS = 800;
/** Time each scene is shown after its last step, in ms. */
export const SCENE_TAIL_MS = 700;
/** Speaking speed used to estimate a clip that has not been generated, in words per second. */
export const SPEECH_WPS = 2.5;

/** Which rule set a step's length. */
export type Driver = "minimum" | "pause" | "reading" | "voice";

/** One step in the plan, with its offsets relative to the scene start. */
export interface PlannedStep {
  action?: string;
  driver: Driver;
  durationMs: number;
  /** True when the voice length is an estimate, not a measured clip. */
  estimated: boolean;
  say?: string;
  startMs: number;
  stepIndex: number;
  voiceMs?: number;
}

/** One scene in the plan. */
export interface PlannedScene {
  durationMs: number;
  label: string;
  sceneIndex: number;
  startMs: number;
  steps: PlannedStep[];
}

/** The whole plan. */
export interface TimingPlan {
  scenes: PlannedScene[];
  totalMs: number;
}

/** Measured or estimated voice length per step, keyed by `scene:step`. */
export type VoiceLengths = Map<string, { estimated: boolean; ms: number }>;

/** Key used for a step in VoiceLengths and in the recorded timeline. */
export function stepKey(sceneIndex: number, stepIndex: number): string {
  return `${sceneIndex}:${stepIndex}`;
}

/** Time a viewer needs to read a caption, in ms. */
export function readingMs(text: string): number {
  const ms = Math.ceil((text.trim().length / READING_CPS) * 1000);
  return Math.max(MIN_READ_MS, ms);
}

/** Estimated speaking time for text, in ms. Used only when no clip exists yet. */
export function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil((words / SPEECH_WPS) * 1000);
}

/** The length of one step and the rule that set it. */
export function stepDuration(input: {
  pauseSeconds?: number;
  say?: string;
  voiceMs?: number;
}): { driver: Driver; durationMs: number } {
  const candidates: [Driver, number][] = [["minimum", MIN_STEP_MS]];
  if (input.say) candidates.push(["reading", readingMs(input.say)]);
  if (input.voiceMs !== undefined && input.voiceMs > 0) {
    candidates.push(["voice", input.voiceMs + VOICE_GAP_MS]);
  }
  if (input.pauseSeconds !== undefined) {
    candidates.push(["pause", Math.round(input.pauseSeconds * 1000)]);
  }
  let best = candidates[0] as [Driver, number];
  for (const c of candidates) if (c[1] > best[1]) best = c;
  return { driver: best[0], durationMs: best[1] };
}

/** A short label for a scene: its title, story id, or URL. */
export function sceneLabel(scene: Scene, index: number): string {
  return scene.title ?? scene.story ?? scene.url ?? `Scene ${index + 1}`;
}

/** Build the plan for a script, given voice lengths (measured or estimated). */
export function planTiming(
  script: VideoScript,
  voice: VoiceLengths = new Map(),
): TimingPlan {
  let sceneStart = 0;
  const scenes = script.scenes.map((scene, sceneIndex) => {
    let t = SCENE_LEAD_MS;
    const steps = scene.steps.map((step, stepIndex) => {
      const v = voice.get(stepKey(sceneIndex, stepIndex));
      const { driver, durationMs } = stepDuration({
        pauseSeconds: step.pause,
        say: step.say,
        voiceMs: v?.ms,
      });
      const planned: PlannedStep = {
        action: step.do,
        driver,
        durationMs,
        estimated: v?.estimated ?? false,
        say: step.say,
        startMs: t,
        stepIndex,
        voiceMs: v?.ms,
      };
      t += durationMs;
      return planned;
    });
    const durationMs = t + SCENE_TAIL_MS;
    const planned: PlannedScene = {
      durationMs,
      label: sceneLabel(scene, sceneIndex),
      sceneIndex,
      startMs: sceneStart,
      steps,
    };
    sceneStart += durationMs;
    return planned;
  });
  return { scenes, totalMs: sceneStart };
}

/** Format ms as m:ss.s for the plan table. */
export function clock(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** The plan as a plain-text table, for --dry-run. */
export function formatPlan(plan: TimingPlan): string {
  const lines: string[] = [];
  for (const scene of plan.scenes) {
    lines.push(
      `Scene ${scene.sceneIndex + 1}: ${scene.label}  (starts ${clock(scene.startMs)}, lasts ${clock(scene.durationMs)})`,
    );
    for (const step of scene.steps) {
      const start = clock(scene.startMs + step.startMs);
      const len = `${(step.durationMs / 1000).toFixed(1)}s`;
      const why =
        step.driver + (step.driver === "voice" && step.estimated ? "~" : "");
      const action = step.action ?? "-";
      const text = step.say ? `"${step.say}"` : "";
      lines.push(
        `  ${String(step.stepIndex + 1).padStart(2)}  ${start}  ${len.padStart(6)}  ${why.padEnd(8)}  ${action.padEnd(9)}  ${text}`,
      );
    }
  }
  lines.push(`Total: ${clock(plan.totalMs)}`);
  return lines.join("\n");
}
