/**
 * The written transcript: one heading per scene and the spoken lines in
 * order. It doubles as a short written guide to the same task.
 */

import type { VideoScript } from "./script.ts";

import { clock, sceneLabel } from "./timing.ts";

/**
 * Markdown transcript for a script. Steps without `say` are left out. With
 * `sceneStarts` (ms into the video, one per scene, intro excluded), each
 * heading carries the time its scene starts.
 */
export function toTranscript(
  script: VideoScript,
  sceneStarts?: number[],
): string {
  const out: string[] = [`# ${script.title}`, ""];
  script.scenes.forEach((scene, i) => {
    const at = sceneStarts?.[i];
    const time = at === undefined ? "" : ` [${clock(at)}]`;
    out.push(`## ${i + 1}. ${sceneLabel(scene, i)}${time}`, "");
    const lines = scene.steps.flatMap((s) => (s.say ? [s.say] : []));
    if (lines.length === 0) out.push("_No narration in this scene._", "");
    else {
      lines.forEach((line, n) => out.push(`${n + 1}. ${line}`));
      out.push("");
    }
  });
  return out.join("\n");
}
