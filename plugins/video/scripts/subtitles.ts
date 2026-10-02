/**
 * Subtitle cues and the SRT and WebVTT files written from them.
 *
 * A long line is split into chunks of at most two caption lines. Each chunk
 * gets a share of the step's time in proportion to its length. The recorder
 * shows the same chunks in the on-screen caption bar, so burned captions and
 * the subtitle files match.
 */

/** One caption on the timeline, in ms from the start of the video. */
export interface Cue {
  endMs: number;
  startMs: number;
  text: string;
}

/** A chunk of a step's text and when it starts, relative to the step. */
export interface Chunk {
  offsetMs: number;
  text: string;
}

/**
 * Wrap text into lines of at most `maxLine` characters, breaking at spaces.
 * Text that needs two lines breaks near the middle, so the second line is
 * never one stray word.
 */
export function wrapLines(text: string, maxLine: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxLine) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length !== 2) return lines;
  let best = lines;
  let bestLongest = Math.max(...lines.map((l) => l.length));
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const longest = Math.max(a.length, b.length);
    if (longest <= maxLine && longest < bestLongest) {
      best = [a, b];
      bestLongest = longest;
    }
  }
  return best;
}

/**
 * Split one sentence that does not fit on two lines into the fewest chunks
 * that do, with about the same length each, so no chunk is a stray word.
 */
function balance(
  sentence: string,
  maxLine: number,
  fits: (s: string) => boolean,
): string[] {
  const words = sentence.split(/\s+/).filter(Boolean);
  const total = sentence.length;
  for (let n = Math.ceil(total / (maxLine * 2)); n <= words.length; n++) {
    const chunks: string[] = [];
    let current: string[] = [];
    let used = 0;
    for (const word of words) {
      const boundary = ((chunks.length + 1) * total) / n;
      if (
        current.length > 0 &&
        chunks.length < n - 1 &&
        used + word.length / 2 > boundary
      ) {
        chunks.push(current.join(" "));
        current = [];
      }
      current.push(word);
      used += word.length + 1;
    }
    chunks.push(current.join(" "));
    if (chunks.every(fits)) return chunks;
  }
  return words;
}

/**
 * Split text into chunks that each fit on two caption lines. Sentence ends
 * are preferred as break points; a sentence longer than two lines is split
 * into chunks of similar length.
 */
export function splitText(text: string, maxLine: number): string[] {
  const limit = maxLine * 2;
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const fits = (s: string): boolean =>
    wrapLines(s, maxLine).length <= 2 && s.length <= limit;
  for (const sentence of sentences) {
    const joined = current ? `${current} ${sentence}` : sentence;
    if (fits(joined)) {
      current = joined;
      continue;
    }
    if (current) chunks.push(current);
    current = "";
    if (fits(sentence)) current = sentence;
    else chunks.push(...balance(sentence, maxLine, fits));
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Split a step's text into chunks and give each a start offset within `durationMs`. */
export function planChunks(
  text: string,
  durationMs: number,
  maxLine: number,
): Chunk[] {
  const pieces = splitText(text, maxLine);
  const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
  let offset = 0;
  return pieces.map((piece) => {
    const chunk = { offsetMs: Math.round(offset), text: piece };
    offset += (piece.length / total) * durationMs;
    return chunk;
  });
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Format ms as HH:MM:SS<sep>mmm. */
export function timestamp(ms: number, sep: "," | "."): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(total % 1000, 3)}`;
}

/** SubRip (.srt) text for the cues. */
export function toSrt(cues: Cue[], maxLine: number): string {
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${timestamp(cue.startMs, ",")} --> ${timestamp(cue.endMs, ",")}\n${wrapLines(cue.text, maxLine).join("\n")}\n`,
    )
    .join("\n");
}

/** WebVTT (.vtt) text for the cues. */
export function toVtt(cues: Cue[], maxLine: number): string {
  const body = cues
    .map(
      (cue) =>
        `${timestamp(cue.startMs, ".")} --> ${timestamp(cue.endMs, ".")}\n${wrapLines(cue.text, maxLine).join("\n")}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}
