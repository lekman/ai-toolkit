/**
 * ElevenLabs text-to-speech over its REST API, and the 1Password read used to
 * fetch the key. Thin wrappers only.
 */

import { execFile } from "node:child_process";

import type { ISpeechClient } from "./interfaces.ts";
import type { VoiceConfig } from "./script.ts";

import { dictionaryLocators, voiceSettings } from "./cache-key.ts";

const API = process.env.ELEVENLABS_API_URL ?? "https://api.elevenlabs.io";

/**
 * Read a secret with the 1Password CLI. The value is returned, never printed.
 * On failure the error carries op's own message (stderr), which names the
 * reference and the reason but not the secret.
 */
export function opRead(ref: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "op",
      ["read", "--no-newline", ref],
      { timeout: 90_000 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const reason = stderr
          .trim()
          .split("\n")[0]
          ?.replace(/^\[ERROR\]\s+\S+\s+\S+\s+/, "");
        reject(
          new Error(
            reason || `op read exited with ${error.code ?? "an error"}`,
          ),
        );
      },
    );
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Speech client for the ElevenLabs API. */
export class ElevenLabsClient implements ISpeechClient {
  readonly #key: string;

  constructor(key: string) {
    this.#key = key;
  }

  /** POST /v1/text-to-speech/{voice_id}; retries on 429 and 5xx. */
  async synthesize(text: string, voice: VoiceConfig): Promise<Uint8Array> {
    const url = `${API}/v1/text-to-speech/${encodeURIComponent(voice.voice_id)}?output_format=${encodeURIComponent(voice.output_format)}`;
    const locators = dictionaryLocators(voice);
    const body = JSON.stringify({
      model_id: voice.model_id,
      ...(locators.length > 0
        ? { pronunciation_dictionary_locators: locators }
        : {}),
      text,
      voice_settings: voiceSettings(voice),
    });
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        body,
        headers: {
          accept: "audio/mpeg",
          "content-type": "application/json",
          "xi-api-key": this.#key,
        },
        method: "POST",
      });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      const retry = res.status === 429 || res.status >= 500;
      if (retry && attempt < 3) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      const detail = (await res.text()).slice(0, 300);
      const hint =
        res.status === 401
          ? " The API key was refused."
          : res.status === 404
            ? " Check voice_id."
            : "";
      throw new Error(
        `ElevenLabs returned ${res.status}.${hint} ${detail}`.trim(),
      );
    }
  }
}
