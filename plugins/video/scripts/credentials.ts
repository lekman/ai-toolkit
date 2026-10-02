/**
 * Where the ElevenLabs API key comes from. The key itself is never printed or
 * logged; errors name only the variable that was missing or failed.
 */

/** Raised when no key can be found. The message says how to provide one. */
export class MissingKeyError extends Error {
  constructor(detail?: string) {
    super(
      [
        "No ElevenLabs API key is available.",
        detail,
        "Set ELEVENLABS_API_KEY, or set ELEVENLABS_API_KEY_REF to a 1Password reference",
        "such as op://Private/ElevenLabs/credential, or run with --no-voice.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    this.name = "MissingKeyError";
  }
}

/**
 * Resolve the key: ELEVENLABS_API_KEY first, then an `op://` reference in
 * ELEVENLABS_API_KEY_REF read through `readSecret` (the 1Password CLI).
 */
export async function resolveApiKey(
  env: Record<string, string | undefined>,
  readSecret: (ref: string) => Promise<string>,
): Promise<string> {
  const direct = env.ELEVENLABS_API_KEY?.trim();
  if (direct) return direct;
  const ref = env.ELEVENLABS_API_KEY_REF?.trim();
  if (!ref) throw new MissingKeyError();
  if (!ref.startsWith("op://")) {
    throw new MissingKeyError("ELEVENLABS_API_KEY_REF must start with op://.");
  }
  let value: string;
  try {
    value = (await readSecret(ref)).trim();
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.split("\n")[0] : "unknown error";
    throw new MissingKeyError(
      `Reading ELEVENLABS_API_KEY_REF with \`op read\` failed: ${reason}`,
    );
  }
  if (!value)
    throw new MissingKeyError(
      "ELEVENLABS_API_KEY_REF resolved to an empty value.",
    );
  return value;
}
