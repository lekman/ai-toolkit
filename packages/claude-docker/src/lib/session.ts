/**
 * One task, one container, one checkout.
 *
 * The unit of work is a task name — normally a ticket. It names the branch, the
 * session directory, the container, and the Remote Control session, so every
 * one of those lines up and a second task never lands in the first one's tree.
 *
 * Nothing from your own checkout is mounted. The container clones the repo
 * itself, over SSH, with a key belonging to a separate account. That is what
 * makes the isolation real rather than nominal: an agent with permissions
 * bypassed can reach the task's branch and nothing else on the machine.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { docker, UserError } from "./engine.js";
import { CONTAINER_HOME, WORKDIR } from "./image.js";

/** Everything this tool keeps on the host lives under one directory. */
export const ROOT = join(homedir(), ".claude", "docker");
export const SESSIONS = join(ROOT, "sessions");
export const DEFAULT_KEY = join(ROOT, "id_ed25519");
/** Claude Code's own config, kept in a volume so a login survives a rebuild. */
export const CONFIG_VOLUME = "claude-docker-config";

/**
 * The two config files that are yours to edit rather than the container's.
 *
 * They live on the host and are mounted over the config volume, so they can be
 * edited, diffed, and version-controlled like any other file — a volume you can
 * only reach through a running container is not somewhere config should hide.
 * Everything else Claude Code writes (the login, history) stays in the volume.
 */
export const SETTINGS_FILE = join(ROOT, "settings.json");
export const MEMORY_FILE = join(ROOT, "CLAUDE.md");

export interface Session {
  /** As typed, for display. */
  task: string;
  /** Sanitised: used for the branch, container, and directory names. */
  slug: string;
  dir: string;
  container: string;
  repo: string;
  base: string;
}

/**
 * Reduce a task name to something git, docker, and a filesystem all accept.
 *
 * Ticket identifiers are the expected input and pass through nearly unchanged;
 * a sentence-shaped task name becomes a readable slug rather than an error.
 */
export function slugify(task: string): string {
  const slug = task
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^[-._/]+|[-._/]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
  if (!slug) {
    throw new UserError(
      `"${task}" has no characters usable in a branch name.\n` +
        `Give the task a name such as PROJ-123 or fix-login-redirect.`,
    );
  }
  return slug;
}

/** Run git in a directory and return stdout, or undefined if it failed. */
function git(args: string[], cwd = process.cwd()): string | undefined {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

/**
 * Normalise a remote to the SSH form.
 *
 * The container authenticates with a key, so an `https://` origin — which is
 * what `gh repo clone` leaves behind — would ask for a password nobody is there
 * to type. Rewriting it is the difference between working and hanging.
 */
export function toSshUrl(remote: string): string {
  const https = /^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote);
  if (https) {
    const host = https[1]!.replace(/^.*@/, "");
    return `git@${host}:${https[2]}.git`;
  }
  if (/^[^@]+@[^:]+:/.test(remote)) {
    return remote.endsWith(".git") ? remote : `${remote}.git`;
  }
  const ssh = /^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(
    remote,
  );
  if (ssh) return `git@${ssh[1]}:${ssh[2]}.git`;
  return remote;
}

/** The repo to clone: given explicitly, or taken from the current checkout. */
export function resolveRepo(explicit?: string): string {
  if (explicit) return toSshUrl(explicit);
  const origin = git(["remote", "get-url", "origin"]);
  if (!origin) {
    throw new UserError(
      `Not in a git repository with an \`origin\` remote, and no --repo given.\n` +
        `Run this from a checkout, or pass --repo git@github.com:owner/name.git.`,
    );
  }
  return toSshUrl(origin);
}

/** The branch a new task branches from. */
export function resolveBase(explicit?: string): string {
  if (explicit) return explicit;
  // The symbolic ref is the remote's own answer, and survives a repo whose
  // default is not `main`.
  const head = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head) return head.replace(/^origin\//, "");
  return git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "main";
}

/** Owner/name from an SSH URL, used to keep one directory per repo. */
function repoSlug(sshUrl: string): string {
  const match = /^[^@]+@[^:]+:(.+?)(?:\.git)?$/.exec(sshUrl);
  return (match?.[1] ?? "repo").replace(/[^A-Za-z0-9._-]+/g, "-");
}

/**
 * Check the key before the container needs it.
 *
 * A missing or group-readable key fails inside the clone, several seconds in,
 * as an SSH error with no mention of permissions. Checking here costs nothing
 * and the message can say what to do.
 */
export function resolveKey(explicit?: string): string {
  const path = explicit ?? DEFAULT_KEY;
  if (!existsSync(path)) {
    throw new UserError(
      `No SSH key at ${path}.\n\n` +
        `  The container clones over SSH using a key that belongs to a separate,\n` +
        `  dedicated account — never your own. That is what limits what an agent\n` +
        `  with permissions bypassed can reach.\n\n` +
        `  Create one and add the public half to that account:\n\n` +
        `    mkdir -p ${ROOT}\n` +
        `    ssh-keygen -t ed25519 -N "" -C claude-docker -f ${DEFAULT_KEY}\n` +
        `    cat ${DEFAULT_KEY}.pub\n\n` +
        `  Give the account read and write access to only the repos it should\n` +
        `  touch. Use --ssh-key to point somewhere else.`,
    );
  }
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) {
    // Fixing it is safe and unambiguous — an SSH private key readable by anyone
    // else is never intended.
    chmodSync(path, 0o600);
  }
  return path;
}

/** Build the session record, creating its directory. */
export function prepare(options: {
  task: string;
  repo?: string;
  base?: string;
}): Session {
  const slug = slugify(options.task);
  const repo = resolveRepo(options.repo);
  const base = resolveBase(options.base);
  const dir = join(SESSIONS, repoSlug(repo), slug);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    task: options.task,
    slug,
    dir,
    container: `claude-docker-${repoSlug(repo).replace(/\//g, "-")}-${slug}`.replace(
      /[^A-Za-z0-9._-]+/g,
      "-",
    ),
    repo,
    base,
  };
}

/** Has this session already been cloned into? */
export function isCloned(session: Session): boolean {
  return existsSync(join(session.dir, ".git"));
}

/** Sessions on disk, for --status. */
export function listSessions(): { repo: string; task: string; dir: string }[] {
  if (!existsSync(SESSIONS)) return [];
  const found: { repo: string; task: string; dir: string }[] = [];
  for (const repo of readdirSync(SESSIONS)) {
    const repoDir = join(SESSIONS, repo);
    if (!statSync(repoDir).isDirectory()) continue;
    for (const task of readdirSync(repoDir)) {
      found.push({ repo, task, dir: join(repoDir, task) });
    }
  }
  return found;
}

export interface RunOptions {
  session: Session;
  image: string;
  keyPath: string;
  gitName: string;
  gitEmail: string;
  remoteControl: boolean;
  bypassPermissions: boolean;
  /** Relax the container's seccomp profile so the inner sandbox can start. */
  sandbox: boolean;
  /** Open a shell instead of starting Claude Code. */
  shell: boolean;
  /** Extra arguments passed through to `claude`. */
  passthrough: string[];
}

/** The full `docker run` argument list. Split out so --status can print it. */
export function runArgs(options: RunOptions): string[] {
  const { session } = options;

  const args = [
    "run",
    "--rm",
    "--interactive",
    // Only when there is a terminal to allocate. `docker run -t` fails outright
    // when stdin is a pipe, which is how this runs from a script or in CI.
    ...(process.stdin.isTTY ? ["--tty"] : []),
    "--name",
    session.container,
    // The session directory is the only host path the container can see.
    "--volume",
    `${session.dir}:${WORKDIR}`,
    // Read-only: the container authenticates with the key but must not be able
    // to alter or replace it.
    "--volume",
    `${options.keyPath}:${CONTAINER_HOME}/.ssh/id_key:ro`,
    // Claude Code's own config, so one login survives across tasks and rebuilds
    // without ever touching your host ~/.claude.
    "--volume",
    `${CONFIG_VOLUME}:${CONTAINER_HOME}/.claude`,
    // Settings and memory are mounted over the volume so they stay editable on
    // the host. A single-file mount takes precedence over the directory mount
    // beneath it, which is what lets these two be host files while the login
    // and history stay in the volume.
    "--volume",
    `${SETTINGS_FILE}:${CONTAINER_HOME}/.claude/settings.json`,
    "--volume",
    `${MEMORY_FILE}:${CONTAINER_HOME}/.claude/CLAUDE.md`,
    "--env",
    `CD_REPO=${session.repo}`,
    "--env",
    `CD_BRANCH=${session.slug}`,
    "--env",
    `CD_BASE=${session.base}`,
    "--env",
    `CD_GIT_NAME=${options.gitName}`,
    "--env",
    `CD_GIT_EMAIL=${options.gitEmail}`,
  ];

  // Claude Code's sandbox uses bubblewrap, which needs to create a user
  // namespace. Docker's default seccomp profile blocks the syscalls that takes,
  // so a sandbox nested in a container cannot start without relaxing it. Only
  // done when the sandbox is actually switched on: it trades a little of the
  // outer boundary for the inner one, and that is only worth it if the inner
  // one exists.
  if (options.sandbox) {
    args.push("--security-opt", "seccomp=unconfined");
  }

  if (options.shell) {
    args.push(options.image, "bash", "-l");
    return args;
  }

  args.push(options.image, "claude");
  if (options.remoteControl) args.push("--remote-control", session.slug);
  if (options.bypassPermissions) args.push("--dangerously-skip-permissions");
  args.push(...options.passthrough);
  return args;
}

/** Make sure the config volume exists, so the first run is not a bare mount. */
export function ensureConfigVolume(): void {
  if (docker(["volume", "inspect", CONFIG_VOLUME]) === undefined) {
    docker(["volume", "create", CONFIG_VOLUME]);
  }
}

/**
 * Settings seeded on first use.
 *
 * The sandbox is the reason this file exists. It is a second, inner boundary:
 * the container decides what exists, and the sandbox decides which domains a
 * Bash command may reach from inside it. Enforced by the OS, so it holds
 * regardless of what the model decided to run.
 *
 * It ships off. Turning it on narrows egress to the list below and breaks
 * anything missing from it, which should be a decision rather than a surprise.
 * Everything is pre-filled so enabling it is a one-line change.
 */
const DEFAULT_SETTINGS = `{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",

  "//": "Read by Claude Code inside the claude-docker container only.",
  "//sandbox": [
    "Set sandbox.enabled to true to narrow egress to allowedDomains below.",
    "It covers Bash commands and their children — not WebFetch or MCP, which",
    "follow permission rules instead. deniedDomains always beats allowedDomains.",
    "strictAllowlist denies an unlisted host outright; without it the sandbox",
    "prompts for one, which nobody is present to answer in an unattended run.",
    "enableWeakerNestedSandbox is required for a sandbox inside a container:",
    "bubblewrap cannot mount a fresh /proc unprivileged. It weakens the inner",
    "boundary, which is acceptable only because the container is the outer one."
  ],

  "sandbox": {
    "enabled": false,
    "strictAllowlist": true,
    "enableWeakerNestedSandbox": true,
    "network": {
      "allowedDomains": [
        "api.anthropic.com",
        "registry.npmjs.org",
        "github.com",
        "*.githubusercontent.com"
      ],
      "deniedDomains": [],
      "allowUnixSockets": false,
      "allowLocalBinding": true
    },
    "//excludedCommands": "docker is incompatible with the sandbox.",
    "excludedCommands": []
  },

  "//autoAllow": "Skip the Bash prompt when a command is sandboxed anyway.",
  "autoAllowBashIfSandboxed": true
}
`;

/** Memory seeded on first use. Applies to every task in every container. */
const DEFAULT_MEMORY = `# claude-docker

Global memory for every task run by \`claude-docker\`. Per-repo \`CLAUDE.md\`
files in the cloned checkout still apply and are read after this one.

## Where you are

You are in a container holding one repository, on one branch, cloned for a
single task. Nothing else of the user's machine is reachable, which is why
permissions are bypassed. Push the task branch; never push to the default
branch.

## Notes

<!-- Add standing instructions for containerised tasks here. -->
`;

/**
 * Is the inner sandbox switched on in the settings file?
 *
 * Worth reading before launching, because turning it on needs a change to how
 * the container itself is run — see `runArgs`. Left to fail on its own, Claude
 * Code warns once and then runs unsandboxed, which is the worst outcome: you
 * believe there is a boundary and there is not.
 */
export function sandboxEnabled(): boolean {
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as {
      sandbox?: { enabled?: boolean };
    };
    return settings.sandbox?.enabled === true;
  } catch {
    // Missing or malformed. Claude Code will report a bad file itself.
    return false;
  }
}

/** Create the host-side config files if they are not there yet. */
export function ensureConfigFiles(): void {
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  if (!existsSync(SETTINGS_FILE)) writeFileSync(SETTINGS_FILE, DEFAULT_SETTINGS);
  if (!existsSync(MEMORY_FILE)) writeFileSync(MEMORY_FILE, DEFAULT_MEMORY);
}
