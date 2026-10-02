import { describe, expect, test } from "bun:test";

import {
  buildTimeline,
  chaptersFile,
  concatList,
  muxArgs,
  outputTarget,
  parseDuration,
  pickWebmCodecs,
  segmentArgs,
} from "../scripts/assemble.ts";

describe("buildTimeline", () => {
  test("places scenes end to end and moves cues and steps onto one clock", () => {
    const timeline = buildTimeline([
      {
        captions: [{ endMs: 2000, startMs: 800, text: "A" }],
        durationMs: 3000,
        label: "One",
        offsetMs: 400,
        steps: [{ endMs: 2000, key: "0:0", startMs: 800 }],
        videoPath: "/1.webm",
      },
      {
        captions: [{ endMs: 1900, startMs: 800, text: "B" }],
        durationMs: 2500,
        label: "Two",
        offsetMs: 380,
        steps: [{ endMs: 1900, key: "1:0", startMs: 800 }],
        videoPath: "/2.webm",
      },
    ]);
    expect(timeline.totalMs).toBe(5500);
    expect(timeline.sceneStarts).toEqual([0, 3000]);
    expect(timeline.cues).toEqual([
      { endMs: 2000, startMs: 800, text: "A" },
      { endMs: 4900, startMs: 3800, text: "B" },
    ]);
    expect(timeline.stepStarts.get("1:0")).toBe(3800);
  });
});

describe("buildTimeline with an intro", () => {
  test("the intro shifts every cue, step and chapter by its length", () => {
    const intro = {
      captions: [],
      durationMs: 3000,
      label: "Title",
      offsetMs: 300,
      steps: [],
      videoPath: "/intro.webm",
    };
    const scene = {
      captions: [{ endMs: 2000, startMs: 800, text: "A" }],
      durationMs: 3500,
      label: "One",
      offsetMs: 400,
      steps: [{ endMs: 2000, key: "0:0", startMs: 800 }],
      videoPath: "/1.webm",
    };
    const timeline = buildTimeline([intro, scene]);
    expect(timeline.cues).toEqual([{ endMs: 5000, startMs: 3800, text: "A" }]);
    expect(timeline.stepStarts.get("0:0")).toBe(3800);
    expect(timeline.chapters).toEqual([
      { endMs: 3000, startMs: 0, title: "Title" },
      { endMs: 6500, startMs: 3000, title: "One" },
    ]);
    expect(timeline.totalMs).toBe(6500);
  });
});

describe("chaptersFile", () => {
  test("writes ffmetadata chapters in ms and escapes special characters", () => {
    expect(
      chaptersFile([
        { endMs: 3000, startMs: 0, title: "Intro" },
        { endMs: 6500.4, startMs: 3000, title: "Step 1; a=b" },
      ]),
    ).toBe(
      ";FFMETADATA1\n" +
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=3000\ntitle=Intro\n" +
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=6500\ntitle=Step 1\\; a\\=b\n",
    );
  });
});

describe("segmentArgs", () => {
  test("cuts from the offset for the duration and encodes H.264", () => {
    const args = segmentArgs({
      durationMs: 3000,
      offsetMs: 412,
      out: "/s.mp4",
      size: { height: 1080, width: 1920 },
      source: "/r.webm",
    });
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual([
      "-ss",
      "0.412",
    ]);
    expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual([
      "-t",
      "3.000",
    ]);
    expect(args).toContain("libx264");
    expect(args.join(" ")).toContain("scale=1920:1080");
  });
});

describe("muxArgs", () => {
  test("with no clips the audio is silence", () => {
    const args = muxArgs({
      clips: [],
      out: "/o.mp4",
      totalMs: 5000,
      video: "/v.mp4",
    }).join(" ");
    expect(args).toContain("anullsrc");
    expect(args).not.toContain("mov_text");
    expect(args).toContain("-t 5.000");
  });

  test("each clip is delayed to its step start and mixed", () => {
    const args = muxArgs({
      clips: [
        { path: "/a.mp3", startMs: 800 },
        { path: "/b.mp3", startMs: 4200.4 },
      ],
      out: "/o.mp4",
      srt: "/o.srt",
      totalMs: 9000,
      video: "/v.mp4",
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("[1:a]adelay=delays=800:all=1[a0]");
    expect(filter).toContain("[2:a]adelay=delays=4200:all=1[a1]");
    expect(filter).toContain("amix=inputs=2:normalize=0");
    expect(args.join(" ")).toContain("-map 3:s");
    expect(args).toContain("mov_text");
  });

  test("chapters come after the subtitles as their own input", () => {
    const args = muxArgs({
      chapters: "/c.txt",
      clips: [{ path: "/a.mp3", startMs: 0 }],
      out: "/o.mp4",
      srt: "/o.srt",
      totalMs: 4000,
      video: "/v.mp4",
    }).join(" ");
    expect(args).toContain("-i /o.srt -f ffmetadata -i /c.txt");
    expect(args).toContain("-map 2:s");
    expect(args).toContain("-map_chapters 3");
  });

  test("without subtitles the chapters take the next input", () => {
    const args = muxArgs({
      chapters: "/c.txt",
      clips: [],
      out: "/o.mp4",
      totalMs: 4000,
      video: "/v.mp4",
    }).join(" ");
    expect(args).toContain("-map_chapters 2");
  });
});

describe("concatList", () => {
  test("quotes paths for the concat demuxer", () => {
    expect(concatList(["/a b/1.mp4", "/it's/2.mp4"])).toBe(
      "file '/a b/1.mp4'\nfile '/it'\\''s/2.mp4'\n",
    );
  });
});

describe("parseDuration", () => {
  test("reads ffmpeg's Duration line", () => {
    expect(parseDuration("  Duration: 00:01:02.35, start: 0.000000")).toBe(
      62_350,
    );
    expect(parseDuration("no header")).toBeUndefined();
  });
});

describe("outputTarget", () => {
  test("the extension picks the format, MP4 by default", () => {
    expect(outputTarget("/o/tour.webm")).toEqual({
      format: "webm",
      path: "/o/tour.webm",
    });
    expect(outputTarget("/o/tour.MP4")).toEqual({
      format: "mp4",
      path: "/o/tour.mp4",
    });
    expect(outputTarget("/o/tour")).toEqual({
      format: "mp4",
      path: "/o/tour.mp4",
    });
    expect(outputTarget("/o/tour.mov")).toEqual({
      format: "mp4",
      path: "/o/tour.mov.mp4",
    });
  });

  test("--format wins and sets the extension", () => {
    expect(outputTarget("/o/tour.mp4", "webm")).toEqual({
      format: "webm",
      path: "/o/tour.webm",
    });
    expect(outputTarget("/o/tour.webm", "mp4").path).toBe("/o/tour.mp4");
  });
});

describe("pickWebmCodecs", () => {
  const list = (...names: string[]): string =>
    `Encoders:\n V..... = Video\n ------\n${names.map((n) => ` V....D ${n.padEnd(20)} ${n} codec`).join("\n")}\n`;

  test("prefers VP9 and Opus", () => {
    expect(
      pickWebmCodecs(list("libx264", "libvpx", "libvpx-vp9", "libopus")),
    ).toEqual({ audio: "libopus", video: "libvpx-vp9" });
  });

  test("falls back to VP8 and Vorbis", () => {
    expect(pickWebmCodecs(list("libvpx", "libvorbis"))).toEqual({
      audio: "libvorbis",
      video: "libvpx",
    });
  });

  test("no audio encoder is allowed; no VP8 or VP9 is an error", () => {
    expect(pickWebmCodecs(list("libvpx-vp9")).audio).toBeUndefined();
    expect(() => pickWebmCodecs(list("libx264", "aac"))).toThrow(
      /cannot encode WebM/,
    );
  });
});

describe("muxArgs for WebM", () => {
  const webm = { audio: "libopus", video: "libvpx-vp9" } as const;

  test("with no clips there is no audio track and no subtitle track", () => {
    const args = muxArgs({
      chapters: "/c.txt",
      clips: [],
      format: "webm",
      out: "/o.webm",
      totalMs: 5000,
      video: "/v.mp4",
      webm,
    });
    const line = args.join(" ");
    expect(line).not.toContain("anullsrc");
    expect(line).not.toContain("-c:a");
    expect(line).not.toContain("-filter_complex");
    expect(line).toContain("-c:v libvpx-vp9 -crf 32 -b:v 0");
    // The chapters are input 1, right after the video.
    expect(line).toContain("-f ffmetadata -i /c.txt -map 0:v -map_chapters 1");
    expect(args.at(-1)).toBe("/o.webm");
  });

  test("clips are mixed at 48 kHz and encoded as Opus", () => {
    const args = muxArgs({
      chapters: "/c.txt",
      clips: [
        { path: "/a.mp3", startMs: 800 },
        { path: "/b.mp3", startMs: 4200 },
      ],
      format: "webm",
      out: "/o.webm",
      totalMs: 9000,
      video: "/v.mp4",
      webm,
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("aformat=sample_rates=48000");
    const line = args.join(" ");
    expect(line).toContain("-map [aout] -map_chapters 3");
    expect(line).toContain("-c:a libopus");
    expect(line).not.toContain("faststart");
  });

  test("VP8 gets a bitrate cap, and a WebM refuses a subtitle track", () => {
    const vp8 = muxArgs({
      clips: [],
      format: "webm",
      out: "/o.webm",
      totalMs: 1000,
      video: "/v.mp4",
      webm: { video: "libvpx" },
    }).join(" ");
    expect(vp8).toContain("-c:v libvpx -crf 10 -b:v 4M");
    expect(() =>
      muxArgs({
        clips: [],
        format: "webm",
        out: "/o.webm",
        srt: "/o.srt",
        totalMs: 1000,
        video: "/v.mp4",
        webm,
      }),
    ).toThrow(/no subtitle track/);
  });

  test("voice needs an audio encoder", () => {
    expect(() =>
      muxArgs({
        clips: [{ path: "/a.mp3", startMs: 0 }],
        format: "webm",
        out: "/o.webm",
        totalMs: 1000,
        video: "/v.mp4",
        webm: { video: "libvpx-vp9" },
      }),
    ).toThrow(/no Opus or Vorbis/);
  });
});
