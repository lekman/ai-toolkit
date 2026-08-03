/**
 * Find a container engine, and start it if it is installed but not running.
 *
 * The distinction that matters is not "is Docker installed" but "can I talk to
 * a daemon right now". `docker` on PATH says nothing — the CLI is a separate
 * package from the engine, and on macOS the engine is a desktop app that may
 * simply not be open. So the check is a real API call, and the repair is
 * launching whichever app provides it.
 */

import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** An error whose message is shown to the user as-is, without a stack trace. */
export class UserError extends Error {}

/** Which app provides the daemon, when one can be identified. */
export type Provider = "OrbStack" | "Docker Desktop" | "unknown";

export interface Engine {
  provider: Provider;
  /** Server version reported by the daemon. */
  version: string;
}

/**
 * Find an executable on PATH. Walks PATH directly rather than shelling out to
 * `command -v`, which needs `shell: true` and trips Node's DEP0190 warning.
 */
export function which(cmd: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, cmd);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here, or not executable — keep looking.
    }
  }
  return undefined;
}

/** Run docker and return stdout, or undefined if it failed. */
export function docker(args: string[], timeoutMs = 60_000): string | undefined {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

/** Run a command with output going to the terminal; resolves to its exit code. */
export function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

/** Run docker with output going to the terminal; resolves to its exit code. */
export function dockerInherit(args: string[]): Promise<number> {
  return run("docker", args);
}

/**
 * Ask the daemon what it is.
 *
 * `docker info` fails when nothing is listening, which is the check that
 * matters. The OS string names the provider — OrbStack and Docker Desktop both
 * report themselves there, so the launcher does not have to guess from which
 * app happens to be installed.
 */
function probe(): Engine | undefined {
  const info = docker(
    ["info", "--format", "{{.ServerVersion}}\t{{.OperatingSystem}}"],
    20_000,
  );
  if (!info) return undefined;
  const [version = "", os = ""] = info.split("\t");
  const provider: Provider = os.includes("OrbStack")
    ? "OrbStack"
    : os.includes("Docker Desktop")
      ? "Docker Desktop"
      : "unknown";
  return { provider, version };
}

/** Where each app lives, and how to start it without blocking. */
const APPS: {
  provider: Provider;
  bundle: string;
  /** A CLI that starts it, preferred over `open` when present. */
  starter?: string;
}[] = [
  {
    provider: "OrbStack",
    bundle: "/Applications/OrbStack.app",
    starter: "orb",
  },
  { provider: "Docker Desktop", bundle: "/Applications/Docker.app" },
];

/** Apps that are installed, in preference order. */
function installed(): Provider[] {
  return APPS.filter(
    (app) => existsSync(app.bundle) || (app.starter && which(app.starter)),
  ).map((app) => app.provider);
}

/** Ask an app to start. Returns false if it could not even be launched. */
function launch(provider: Provider): boolean {
  const app = APPS.find((candidate) => candidate.provider === provider);
  if (!app) return false;

  // `orb start` is synchronous and reports failure; `open -a` only says the app
  // was launched, which is why the CLI is preferred where one exists.
  if (app.starter && which(app.starter)) {
    const result = spawnSync(app.starter, ["start"], {
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.status === 0) return true;
  }
  if (process.platform !== "darwin") return false;
  return (
    spawnSync("open", ["-a", app.bundle], { timeout: 30_000 }).status === 0
  );
}

/** Wait for the daemon to answer, or give up. */
async function waitForDaemon(timeoutMs: number): Promise<Engine | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const engine = probe();
    if (engine) return engine;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

const NOTHING_INSTALLED = new UserError(
  `No container engine found.\n\n` +
    `  Install one, then run this again:\n\n` +
    `    OrbStack        https://orbstack.dev   ${"(lighter, faster on a Mac)"}\n` +
    `    Docker Desktop  https://docker.com/products/docker-desktop\n\n` +
    `  Either provides the \`docker\` command this needs. On Linux, install the\n` +
    `  Docker Engine and make sure the service is running.`,
);

/**
 * Get a running engine, starting one if it is installed but idle.
 *
 * Starting the app is the whole point — a stopped Docker Desktop is the most
 * common reason a container command fails, and it fails with a socket error
 * that says nothing about the app being closed.
 */
export async function ensureEngine(options: {
  start: boolean;
  timeoutMs?: number;
}): Promise<Engine> {
  const running = probe();
  if (running) return running;

  if (!which("docker")) {
    // No CLI at all. Distinguish "engine installed but CLI missing" from
    // "nothing here", because the fix is different.
    const apps = installed();
    if (apps.length === 0) throw NOTHING_INSTALLED;
    throw new UserError(
      `${apps[0]} is installed but the \`docker\` command is not on your PATH.\n` +
        `Open ${apps[0]} once to finish its setup, then run this again.`,
    );
  }

  const apps = installed();
  if (apps.length === 0) {
    if (process.platform !== "darwin") {
      throw new UserError(
        `The docker command is installed but no daemon is responding.\n` +
          `Start it — usually \`sudo systemctl start docker\` — and try again.`,
      );
    }
    throw NOTHING_INSTALLED;
  }

  const provider = apps[0]!;
  if (!options.start) {
    throw new UserError(
      `${provider} is installed but not running, and --no-start was given.\n` +
        `Start it and try again.`,
    );
  }

  process.stderr.write(`[claude-docker] starting ${provider} … `);
  if (!launch(provider)) {
    process.stderr.write("failed\n");
    throw new UserError(
      `Could not start ${provider}. Start it yourself, then try again.`,
    );
  }
  const engine = await waitForDaemon(options.timeoutMs ?? 120_000);
  if (!engine) {
    process.stderr.write("timed out\n");
    throw new UserError(
      `${provider} did not become ready in time.\n` +
        `It may still be starting — wait a moment and try again.`,
    );
  }
  process.stderr.write("ready\n");
  return engine;
}
