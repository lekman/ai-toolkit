/**
 * The clone key, and the account it belongs to.
 *
 * This is the step the whole boundary rests on, and it is the one the tool
 * cannot silently do for you: a key is only useful once it is attached to a
 * GitHub account, and that account has to be a *different* one from yours. An
 * agent with a key can push anywhere that key can reach, so a key on your own
 * account turns the container from a boundary into a formality.
 *
 * Two pieces of luck make this checkable rather than a promise you make to
 * yourself. GitHub answers `ssh -T` with "Hi <login>!", so a key can be traced
 * to its account. And `gh` can attach a key over the API, so the browser paste
 * that everyone gets wrong is avoidable entirely.
 */

import * as p from "@clack/prompts";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import pc from "picocolors";

import { run, UserError, which } from "./engine.js";

const GITHUB_SSH = "git@github.com";
const KEYS_URL = "https://github.com/settings/keys";

/** Directories worth looking in for an existing key. */
const SEARCH_DIRS = [join(homedir(), ".ssh"), join(homedir(), ".claude", "docker")];

export interface Candidate {
  /** Path to the private key. */
  path: string;
  /** The account it authenticates as, once known. */
  account?: string;
  /** True when the account is one this machine is signed in to. */
  isOwn?: boolean;
}

/**
 * Private keys on disk that could actually be mounted into a container.
 *
 * The "on disk" part is the filter that matters. A key held in an agent, such
 * as 1Password's, leaves only a `.pub` behind — useful for signing on this
 * machine, useless here, because the container needs the private half as a file
 * and the agent is deliberately never forwarded.
 */
export function listCandidateKeys(): string[] {
  const found: string[] = [];
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".pub")) continue;
      const path = join(dir, name);
      try {
        if (!statSync(path).isFile()) continue;
        if (!existsSync(`${path}.pub`)) continue;
        // A real private key, not a config file that happens to sit alongside one.
        const head = readFileSync(path, "utf8").slice(0, 40);
        if (!head.startsWith("-----BEGIN")) continue;
        found.push(path);
      } catch {
        // Unreadable is the same as unusable here.
      }
    }
  }
  return found;
}

/**
 * Which account a key authenticates as, or undefined if GitHub does not know it.
 *
 * Exit code is not the signal. GitHub always refuses the shell, so a successful
 * authentication still exits non-zero; the greeting on stderr carries the answer.
 */
export function keyAccount(keyPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(
      "ssh",
      [
        "-T",
        "-i",
        keyPath,
        "-o",
        "IdentitiesOnly=yes",
        // No agent, no other keys: the answer must be about this key alone.
        "-o",
        "IdentityAgent=none",
        // Never block on a passphrase or a host-key question.
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        GITHUB_SSH,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const done = (): void => resolve(/^Hi ([^!\s]+)!/m.exec(stderr)?.[1]);
    child.on("close", done);
    child.on("error", () => resolve(undefined));
    setTimeout(() => {
      child.kill();
      done();
    }, 20_000).unref();
  });
}

/**
 * Where a verified key-to-account answer is remembered.
 *
 * The check is a network round trip, and the answer only changes when the key
 * does. Caching it against the key's modification time keeps the launch
 * pre-flight free after the first run, so every launch can afford to verify
 * rather than only the ones that go through setup.
 */
const ACCOUNT_CACHE = join(homedir(), ".claude", "docker", "key-account.json");

/**
 * The account a key belongs to, from cache when the key has not changed.
 *
 * Only successful answers are cached. A key GitHub does not recognise is
 * usually one that is about to be attached, and remembering that would mean
 * the fix does not take effect until something invalidates it.
 */
export async function verifiedAccount(
  keyPath: string,
  options: { refresh?: boolean } = {},
): Promise<string | undefined> {
  let mtimeMs: number | undefined;
  try {
    mtimeMs = statSync(keyPath).mtimeMs;
  } catch {
    return undefined;
  }

  if (!options.refresh) {
    try {
      const cached = JSON.parse(readFileSync(ACCOUNT_CACHE, "utf8")) as {
        path?: string;
        mtimeMs?: number;
        account?: string;
      };
      if (cached.path === keyPath && cached.mtimeMs === mtimeMs) {
        return cached.account;
      }
    } catch {
      // No cache, or an unreadable one. Ask GitHub.
    }
  }

  const account = await keyAccount(keyPath);
  if (account) {
    try {
      writeFileSync(
        ACCOUNT_CACHE,
        `${JSON.stringify({ path: keyPath, mtimeMs, account }, null, 2)}\n`,
        { mode: 0o600 },
      );
    } catch {
      // A cache that cannot be written costs a round trip, nothing more.
    }
  }
  return account;
}

export interface GhAccount {
  login: string;
  active: boolean;
}

/**
 * GitHub accounts this machine is signed in to, newest state first.
 *
 * Undefined when `gh` is absent, which is different from "none": the separation
 * check cannot run, and the caller says so rather than reporting a pass.
 */
export function ghAccounts(): GhAccount[] | undefined {
  if (!which("gh")) return undefined;
  const result = spawnSync("gh", ["auth", "status"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const accounts = new Map<string, boolean>();
  let current: string | undefined;
  for (const line of text.split("\n")) {
    const login = /account\s+(\S+)/.exec(line);
    if (login) {
      current = login[1]!;
      if (!accounts.has(current)) accounts.set(current, false);
      continue;
    }
    const active = /Active account:\s*true/.exec(line);
    if (active && current) accounts.set(current, true);
  }
  return [...accounts].map(([login, isActive]) => ({ login, active: isActive }));
}

/** Create an ed25519 key with no passphrase, since nobody is there to type one. */
export function generateKey(keyPath: string): void {
  spawnSync("mkdir", ["-p", dirname(keyPath)], { timeout: 10_000 });
  const result = spawnSync(
    "ssh-keygen",
    ["-t", "ed25519", "-N", "", "-C", "claude-docker", "-f", keyPath],
    { encoding: "utf8", timeout: 30_000 },
  );
  if (result.status !== 0) {
    throw new UserError(
      `ssh-keygen failed.\n${result.stderr?.trim() ?? ""}`.trim(),
    );
  }
}

/** Put text on the clipboard, where the platform allows it. */
function copyToClipboard(text: string): boolean {
  const tool =
    process.platform === "darwin"
      ? { cmd: "pbcopy", args: [] as string[] }
      : which("wl-copy")
        ? { cmd: "wl-copy", args: [] as string[] }
        : which("xclip")
          ? { cmd: "xclip", args: ["-selection", "clipboard"] }
          : undefined;
  if (!tool || !which(tool.cmd)) return false;
  return (
    spawnSync(tool.cmd, tool.args, { input: text, timeout: 10_000 }).status === 0
  );
}

/** Attach a public key to a GitHub account through the API, as that account. */
async function ghAddKey(
  keyPath: string,
  account: string,
  restoreTo?: string,
): Promise<boolean> {
  // `gh ssh-key add` acts as the active account and takes no account flag, so
  // the active one is switched, used, and switched back.
  const switched =
    spawnSync("gh", ["auth", "switch", "--user", account], {
      encoding: "utf8",
      timeout: 20_000,
    }).status === 0;
  if (!switched) return false;

  const added = await run("gh", [
    "ssh-key",
    "add",
    `${keyPath}.pub`,
    "--title",
    "claude-docker",
  ]);

  if (restoreTo && restoreTo !== account) {
    spawnSync("gh", ["auth", "switch", "--user", restoreTo], {
      timeout: 20_000,
    });
  }
  return added === 0;
}

/** Open a URL in the default browser, best effort. */
function openUrl(url: string): boolean {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  if (!which(cmd)) return false;
  return spawnSync(cmd, [url], { timeout: 15_000 }).status === 0;
}

/** Ask GitHub about every candidate at once, rather than one round trip each. */
async function identify(paths: string[]): Promise<Candidate[]> {
  const mine = new Set((ghAccounts() ?? []).map((a) => a.login));
  const accounts = await Promise.all(paths.map((path) => keyAccount(path)));
  return paths.map((path, i) => {
    const account = accounts[i];
    return {
      path,
      account,
      isOwn: account ? mine.has(account) : undefined,
    };
  });
}

/** One line per key in the picker: where it is, and who GitHub says it is. */
function describe(candidate: Candidate): string {
  if (!candidate.account) return pc.dim("not registered with GitHub");
  return candidate.isOwn
    ? pc.yellow(`${candidate.account} — signed in here, not isolated`)
    : pc.green(`${candidate.account}`);
}

/**
 * Walk someone through choosing or creating the clone key.
 *
 * Written as a guided flow rather than an error message because the failure it
 * prevents, attaching the key to your own account, looks exactly like success
 * until an agent pushes somewhere it should never have reached.
 */
export async function setupKey(defaultPath: string): Promise<string> {
  p.intro(pc.bgCyan(pc.black(" claude-docker key setup ")));

  if (!which("ssh-keygen")) {
    throw new UserError("ssh-keygen is required and is not on your PATH.");
  }

  p.log.info(
    `The container clones with one key, so that key decides what an agent can\n` +
      `reach. It must belong to a ${pc.bold("separate")} GitHub account, never yours.`,
  );

  const spinner = p.spinner();
  spinner.start("Looking for usable keys and asking GitHub who they belong to");
  const candidates = await identify(listCandidateKeys());
  spinner.stop(
    candidates.length
      ? `Found ${candidates.length} key${candidates.length === 1 ? "" : "s"} on this machine`
      : "No usable keys on this machine",
  );

  const options = [
    ...candidates.map((candidate) => ({
      value: candidate.path,
      label: candidate.path.replace(homedir(), "~"),
      hint: describe(candidate),
    })),
    {
      value: "\0new",
      label: "Create a new key",
      hint: "recommended for a dedicated agent account",
    },
  ];

  const chosen = await p.select({
    message: "Which key should the container clone with?",
    options,
    initialValue: candidates.find((c) => c.isOwn === false)?.path ?? "\0new",
  });
  if (p.isCancel(chosen)) {
    throw new UserError("Nothing was changed.");
  }

  if (chosen !== "\0new") {
    const picked = candidates.find((c) => c.path === chosen)!;
    if (!picked.account) {
      // Existing but unknown to GitHub. Left alone this fails several seconds
      // into the clone, as an SSH error that never mentions the key.
      p.log.warn(
        `GitHub does not recognise this key, so the clone would fail.\n` +
          `It needs attaching to an account first.`,
      );
      await attach(picked.path);
      return picked.path;
    }
    if (picked.isOwn) {
      p.log.warn(
        `${picked.account} is signed in on this machine, so an agent holding\n` +
          `this key can reach everything you can. That is the situation the\n` +
          `container exists to prevent.`,
      );
      const anyway = await p.confirm({
        message: `Use ${picked.account} anyway?`,
        initialValue: false,
      });
      if (p.isCancel(anyway) || !anyway) return setupKey(defaultPath);
    }
    p.outro(`Using ${picked.path}${picked.account ? ` (${picked.account})` : ""}`);
    return picked.path;
  }

  // Create, then attach.
  if (existsSync(defaultPath)) {
    p.log.warn(`${defaultPath} already exists and would be overwritten.`);
    const overwrite = await p.confirm({
      message: "Overwrite it?",
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) throw new UserError("Stopped.");
    spawnSync("rm", ["-f", defaultPath, `${defaultPath}.pub`], {
      timeout: 10_000,
    });
  }
  generateKey(defaultPath);
  p.log.success(`Created ${defaultPath}`);

  // `attach` reports the account; the caller needs the path to mount.
  await attach(defaultPath);
  return defaultPath;
}

/**
 * Get a freshly created key onto an account that is not yours.
 *
 * `gh` does this over the API when it can, because the manual path — copy the
 * public key, remember to switch browser account, paste it in the right place —
 * is where people accidentally use their own account.
 */
async function attach(keyPath: string): Promise<string> {
  const publicKey = readFileSync(`${keyPath}.pub`, "utf8").trim();
  let accounts = ghAccounts();

  if (accounts === undefined) {
    p.log.warn(
      `The \`gh\` CLI is not installed, so the key has to go in by hand and I\n` +
        `cannot verify which account it lands on.`,
    );
    return manual(keyPath, publicKey);
  }

  const previouslyActive = accounts.find((a) => a.active)?.login;

  p.log.info(
    accounts.length
      ? `Signed in here: ${accounts.map((a) => a.login).join(", ")}.\n` +
          `The key must ${pc.bold("not")} go on any of those.`
      : `No GitHub accounts are signed in with \`gh\` yet.`,
  );

  const target = await p.select({
    message: "Which account should hold the key?",
    options: [
      {
        value: "\0login",
        label: "Log in to the dedicated account now",
        hint: "opens `gh auth login`",
      },
      ...accounts.map((a) => ({
        value: a.login,
        label: a.login,
        hint: pc.yellow("signed in here, not isolated"),
      })),
      { value: "\0manual", label: "Add it myself in the browser" },
    ],
    initialValue: "\0login",
  });
  if (p.isCancel(target)) throw new UserError("Nothing was changed.");

  if (target === "\0manual") return manual(keyPath, publicKey);

  let account = target;
  if (target === "\0login") {
    p.log.step(
      `Sign in as the ${pc.bold("dedicated")} account, not your own.\n` +
        `Choose SSH as the protocol when asked, and decline the key upload —\n` +
        `this adds it straight after.`,
    );
    await run("gh", ["auth", "login"]);
    const after = ghAccounts() ?? [];
    const added = after.filter(
      (a) => !accounts!.some((before) => before.login === a.login),
    );
    if (added.length !== 1) {
      p.log.warn("Could not tell which account was added.");
      return manual(keyPath, publicKey);
    }
    account = added[0]!.login;
    accounts = after;
    p.log.success(`Signed in as ${account}`);
  }

  const uploading = p.spinner();
  uploading.start(`Adding the key to ${account}`);
  const ok = await ghAddKey(keyPath, account, previouslyActive);
  uploading.stop(ok ? `Added to ${account}` : `Could not add it to ${account}`);
  if (!ok) return manual(keyPath, publicKey);

  return verify(keyPath);
}

/** The browser path, for when `gh` cannot do it. */
async function manual(keyPath: string, publicKey: string): Promise<string> {
  p.note(
    `${publicKey}\n\n` +
      pc.yellow("Add this to a GitHub account that is not yours.") +
      `\n` +
      pc.dim(
        `A private window or a second browser profile is the least painful way\n` +
          `to be signed in as the dedicated account while you do it.`,
      ),
    "Public key",
  );
  if (copyToClipboard(publicKey)) p.log.success("Copied to your clipboard.");

  const shouldOpen = await p.confirm({
    message: `Open ${KEYS_URL}?`,
    initialValue: true,
  });
  if (!p.isCancel(shouldOpen) && shouldOpen && !openUrl(KEYS_URL)) {
    p.log.warn(`Could not open a browser. Go to ${KEYS_URL}`);
  }
  return verify(keyPath);
}

/** Loop until GitHub itself confirms the key is on an account that is not yours. */
async function verify(keyPath: string): Promise<string> {
  for (;;) {
    const spinner = p.spinner();
    spinner.start("Asking GitHub which account this key belongs to");
    const account = await keyAccount(keyPath);
    const mine = ghAccounts();
    spinner.stop(
      account ? `GitHub says: ${account}` : "GitHub does not recognise the key",
    );

    if (!account) {
      const again = await p.confirm({
        message: "Not attached yet. Check again?",
        initialValue: true,
      });
      if (p.isCancel(again) || !again) {
        throw new UserError(
          `Stopped before the key was verified.\n` +
            `Re-run with: claude-docker --setup-key`,
        );
      }
      continue;
    }

    if (mine === undefined) {
      p.log.warn(
        `\`gh\` is not installed, so I cannot check whether ${account} is one of\n` +
          `yours. Confirm it yourself: it must not be.`,
      );
    } else if (mine.some((a) => a.login === account)) {
      p.log.error(
        `${pc.red(account)} is signed in on this machine.\n\n` +
          `  An agent holding this key can push anywhere ${account} can, which is\n` +
          `  what the container exists to prevent.`,
      );
      const anyway = await p.confirm({
        message: `Use ${account} anyway?`,
        initialValue: false,
      });
      if (p.isCancel(anyway) || !anyway) {
        throw new UserError(
          `Stopped. Create a second GitHub account and re-run:\n` +
            `  claude-docker --setup-key`,
        );
      }
    } else {
      p.log.success(`${account} is not signed in here. That is the separation.`);
    }

    p.log.info(
      `Give ${account} access to only the repos it should touch.\n` +
        `Anything it can reach, the agent can reach.`,
    );
    p.outro(`Key ready: ${keyPath} (${account})`);
    return account;
  }
}
