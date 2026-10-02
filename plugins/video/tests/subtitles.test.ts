import { describe, expect, test } from "bun:test";

import {
  planChunks,
  splitText,
  timestamp,
  toSrt,
  toVtt,
  wrapLines,
} from "../scripts/subtitles.ts";

describe("wrapLines", () => {
  test("breaks at spaces within the line limit", () => {
    expect(wrapLines("one two three four", 9)).toEqual([
      "one two",
      "three",
      "four",
    ]);
  });
});

describe("splitText", () => {
  test("short text is one chunk", () => {
    expect(splitText("Open the case list.", 42)).toEqual([
      "Open the case list.",
    ]);
  });
  test("sentences that fit two lines together stay together", () => {
    expect(splitText("Open the list. Pick a case.", 42)).toEqual([
      "Open the list. Pick a case.",
    ]);
  });
  test("long text splits at sentence ends first", () => {
    const a =
      "This first sentence is long enough to fill most of two lines here.";
    const b = "This second one is short.";
    expect(splitText(`${a} ${b}`, 42)).toEqual([a, b]);
  });
  test("a sentence longer than two lines splits between words", () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const chunks = splitText(words, 42);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks)
      expect(wrapLines(c, 42).length).toBeLessThanOrEqual(2);
    expect(chunks.join(" ")).toBe(words);
  });
  test("a sentence just over two lines splits evenly, with no stray last word", () => {
    const text =
      "Each card shows a rate, how many cases it is based on, and the change since the last period.";
    const chunks = splitText(text, 42);
    expect(chunks.length).toBe(2);
    const [a, b] = chunks.map((c) => c.length);
    expect(Math.abs((a ?? 0) - (b ?? 0))).toBeLessThan(15);
  });
});

describe("planChunks", () => {
  test("offsets follow text length", () => {
    const a =
      "This first sentence is long enough to fill most of two lines here.";
    const b = "This second one is short.";
    const chunks = planChunks(`${a} ${b}`, 9200, 42);
    expect(chunks.map((c) => c.text)).toEqual([a, b]);
    expect(chunks.map((c) => c.offsetMs)).toEqual([
      0,
      Math.round((a.length / (a.length + b.length)) * 9200),
    ]);
  });
});

describe("timestamp", () => {
  test("formats hours, minutes, seconds and ms", () => {
    expect(timestamp(3_723_045, ",")).toBe("01:02:03,045");
    expect(timestamp(1500, ".")).toBe("00:00:01.500");
  });
});

const cues = [
  { endMs: 2500, startMs: 800, text: "Open the case list." },
  {
    endMs: 6000,
    startMs: 2500,
    text: "Each row is one case waiting for a clinical review.",
  },
];

describe("toSrt", () => {
  test("numbers cues and wraps long lines", () => {
    expect(toSrt(cues, 42)).toBe(
      "1\n00:00:00,800 --> 00:00:02,500\nOpen the case list.\n\n" +
        "2\n00:00:02,500 --> 00:00:06,000\nEach row is one case waiting\nfor a clinical review.\n",
    );
  });
});

describe("toVtt", () => {
  test("starts with the WEBVTT header and uses dots", () => {
    const vtt = toVtt(cues, 42);
    expect(vtt.startsWith("WEBVTT\n\n00:00:00.800 --> 00:00:02.500\n")).toBe(
      true,
    );
    expect(vtt).toContain(
      "00:00:02.500 --> 00:00:06.000\nEach row is one case waiting\nfor a clinical review.\n",
    );
  });
});
