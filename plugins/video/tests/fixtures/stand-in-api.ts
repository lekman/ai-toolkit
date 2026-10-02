/**
 * A stand-in for the ElevenLabs text-to-speech API, run as its own process
 * so the tests can run the CLI synchronously. Answers every request with the
 * same MP3, writes its port to `<dir>/port` once it listens, and appends
 * each request to `<dir>/requests.jsonl`.
 *
 * Usage: bun stand-in-api.ts <tone.mp3> <dir>
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [mp3, dir] = process.argv.slice(2) as [string, string];
const tone = readFileSync(mp3);
const server = Bun.serve({
  async fetch(req) {
    const body = (await req.json()) as { text: string };
    appendFileSync(
      join(dir, "requests.jsonl"),
      `${JSON.stringify({ key: req.headers.get("xi-api-key"), text: body.text, url: req.url })}\n`,
    );
    return new Response(tone, { headers: { "content-type": "audio/mpeg" } });
  },
  hostname: "127.0.0.1",
  port: 0,
});
writeFileSync(join(dir, "port"), String(server.port));
