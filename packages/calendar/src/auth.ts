#!/usr/bin/env bun
/**
 * Device-code OAuth for Microsoft Graph, no SDK.
 *
 *   bun src/auth.ts start      request a device code; prints URL + code, saves
 *                              pending state so `finish` can complete later
 *   bun src/auth.ts finish     poll for the token after the code is entered;
 *                              caches tokens (0600) and verifies calendar access
 *   bun src/auth.ts calendars  list calendar names (verifies auth end to end)
 */
import { existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  AuthError,
  graph,
  loadConfig,
  readJson,
  SCOPE,
  TOKEN_PATH,
  type TokenCache,
  tokenUrl,
  writePrivate,
} from "./client";

const PENDING_PATH = join(homedir(), ".claude", "calendar-devicecode.json");

async function start(): Promise<void> {
  const { tenant, clientId } = loadConfig();
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, scope: SCOPE }),
    },
  );
  const data = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    message: string;
  };
  if (!res.ok) {
    console.error("Device-code request failed:", JSON.stringify(data));
    process.exit(1);
  }
  writePrivate(PENDING_PATH, {
    device_code: data.device_code,
    expires_at: Date.now() + data.expires_in * 1000,
  });
  console.log(data.message);
  console.log(`\nCode: ${data.user_code}`);
  console.log(`URL:  ${data.verification_uri}`);
}

async function finish(): Promise<void> {
  const { tenant, clientId } = loadConfig();
  if (!existsSync(PENDING_PATH)) {
    console.error("No pending device code — run `start` first.");
    process.exit(1);
  }
  const pending = readJson<{ device_code: string; expires_at: number }>(
    PENDING_PATH,
  );
  if (Date.now() > pending.expires_at) {
    unlinkSync(PENDING_PATH);
    console.error("Device code expired — run `start` again.");
    process.exit(1);
  }

  // Poll until the user has completed sign-in in the browser.
  for (;;) {
    const res = await fetch(tokenUrl(tenant), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: pending.device_code,
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (res.ok) {
      writePrivate(TOKEN_PATH, {
        access_token: data.access_token as string,
        refresh_token: data.refresh_token as string,
        expires_at: Date.now() + (data.expires_in as number) * 1000,
      } satisfies TokenCache);
      unlinkSync(PENDING_PATH);
      // /me needs User.Read, which we don't request — verify with the scope we have.
      const cals = await graph<{ value: unknown[] }>("/me/calendars");
      console.log(
        `Signed in — ${cals.value.length} calendars visible. Token cached at ${TOKEN_PATH}`,
      );
      return;
    }
    if (data.error === "authorization_pending") {
      await Bun.sleep(5000);
      continue;
    }
    console.error(`Sign-in failed: ${data.error} — ${data.error_description}`);
    process.exit(1);
  }
}

async function calendars(): Promise<void> {
  const data = await graph<{ value: Array<{ name: string; id: string }> }>(
    "/me/calendars",
  );
  for (const c of data.value) console.log(`${c.name}\t${c.id}`);
}

try {
  const command = process.argv[2];
  if (command === "start") await start();
  else if (command === "finish") await finish();
  else if (command === "calendars") await calendars();
  else {
    console.error("Usage: bun src/auth.ts <start|finish|calendars>");
    process.exit(1);
  }
} catch (error) {
  if (error instanceof AuthError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
