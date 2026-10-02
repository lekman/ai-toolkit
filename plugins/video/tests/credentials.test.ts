import { describe, expect, test } from "bun:test";

import { MissingKeyError, resolveApiKey } from "../scripts/credentials.ts";

const never = async (): Promise<string> => {
  throw new Error("op must not be called");
};

describe("resolveApiKey", () => {
  test("ELEVENLABS_API_KEY wins over a reference", async () => {
    expect(
      await resolveApiKey(
        { ELEVENLABS_API_KEY: "k1", ELEVENLABS_API_KEY_REF: "op://v/i/f" },
        never,
      ),
    ).toBe("k1");
  });

  test("reads an op:// reference through the 1Password reader", async () => {
    let asked = "";
    const key = await resolveApiKey(
      { ELEVENLABS_API_KEY_REF: "op://Private/ElevenLabs/credential" },
      async (ref) => {
        asked = ref;
        return "k2\n";
      },
    );
    expect(asked).toBe("op://Private/ElevenLabs/credential");
    expect(key).toBe("k2");
  });

  test("no key at all says how to provide one", async () => {
    const error = await resolveApiKey({}, never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingKeyError);
    expect((error as Error).message).toContain("--no-voice");
  });

  test("a reference that is not op:// is refused", async () => {
    const error = await resolveApiKey(
      { ELEVENLABS_API_KEY_REF: "vault/item" },
      never,
    ).catch((e: unknown) => e);
    expect((error as Error).message).toContain("must start with op://");
  });

  test("a failed op read is reported without any secret", async () => {
    const error = await resolveApiKey(
      { ELEVENLABS_API_KEY_REF: "op://v/i/f" },
      async () => {
        throw new Error("op read exited with 1");
      },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingKeyError);
    expect((error as Error).message).toContain("op read exited with 1");
  });
});
