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
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { docker, UserError } from "./engine.js";
import {
  CONTAINER_HOME,
  CONTAINER_VAULT,
  MANAGED_SETTINGS,
  WORKDIR,
} from "./image.js";

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

/**
 * Shared instruction files, mounted so `CLAUDE.md` can import them.
 *
 * Your own `~/.claude/CLAUDE.md` usually imports standards from a repo with
 * `@~/Repo/.../standards/CLAUDE.md`. That path does not exist in the container,
 * so the import silently resolves to nothing and the agent quietly loses every
 * standing instruction you have.
 *
 * Point this at the directory instead and the imports resolve. A symlink is the
 * usual answer, so the container reads whatever the repo currently says rather
 * than a copy that drifts.
 */
export const STANDARDS_LINK = join(ROOT, "standards");
export const CONTAINER_STANDARDS = `${CONTAINER_HOME}/.claude/standards`;

/**
 * The Obsidian vault, mounted so handover notes and plans are readable.
 *
 * A containerised agent is one that was not in the conversation, so it needs
 * the same written handover a fresh session on another machine needs. Those
 * notes live in the vault, and a vault the container cannot see is a handover
 * it cannot read.
 *
 * Read-only by default. The vault holds every client's material, and this
 * container holds one task — mounting all of it writable would hand a task
 * agent the run of the notes. `--vault-write` opts in, for the case where the
 * container is expected to write its *own* handover back.
 */
export const VAULT_LINK = join(ROOT, "vault");
/** Generated per-run config, mounted read-only. Never inside the checkout. */
export const GENERATED = join(ROOT, "generated");
/** Where the host keeps the vault/client mapping the obsidian skills read. */
export const HOST_OBSIDIAN_CONFIG = join(homedir(), ".claude", "obsidian.json");
export const CONTAINER_OBSIDIAN_CONFIG = `${CONTAINER_HOME}/.claude/obsidian.json`;
/** Marketplace plugins enabled in every container. */
export const BASE_PLUGINS = ["git", "wrap"];
/** Added when a vault is mounted — all of these read the vault. */
export const VAULT_PLUGINS = ["obsidian", "planner"];

/**
 * Where the vault comes from: the flag, the environment, or the conventional
 * symlink. Same resolution as `resolveStandards`, for the same reason —
 * container engines follow symlinks inconsistently, so resolve here.
 */
export function resolveVault(explicit?: string): string | undefined {
  const path = explicit ?? process.env.CLAUDE_DOCKER_VAULT ?? VAULT_LINK;
  if (!existsSync(path)) {
    if (explicit) throw new UserError(`No such directory: ${path}`);
    return undefined;
  }
  const real = realpathSync(path);
  if (!statSync(real).isDirectory()) {
    throw new UserError(`Not a directory: ${path}`);
  }
  return real;
}

interface ObsidianConfig {
  vault?: string;
  dashboard?: string;
  clients?: Record<string, string>;
  default_client?: string;
  planner?: Record<string, unknown>;
}

/**
 * The active client for a host directory: the longest matching path prefix in
 * the `clients` map. Same rule the obsidian and wrap skills apply, so the
 * container resolves to the client the operator was already working for.
 */
export function activeClient(
  config: ObsidianConfig,
  cwd: string,
): string | undefined {
  const matches = Object.entries(config.clients ?? {})
    .filter(([prefix]) => cwd.startsWith(prefix))
    .sort(([a], [b]) => b.length - a.length);
  return matches[0]?.[1] ?? config.default_client;
}

/**
 * The container's `obsidian.json`, derived from the host's.
 *
 * Two things are rewritten rather than copied. The vault path becomes the
 * container's mount point, because the host path does not exist inside. And
 * the client map is reduced to the **one** client this task belongs to, keyed
 * on the container's single checkout at ${WORKDIR} — every other client's name
 * and repo path stays on the host, where a task agent has no reason to see it.
 *
 * Returns undefined when the host has no config, or when no client resolves;
 * the vault still mounts, the skills simply have nothing to key off.
 */
export function buildObsidianConfig(
  config: ObsidianConfig,
  cwd: string,
): string | undefined {
  const client = activeClient(config, cwd);
  if (!client) return undefined;
  const planner = config.planner?.[client];
  return `${JSON.stringify(
    {
      vault: CONTAINER_VAULT,
      dashboard: config.dashboard ?? "Dashboard.md",
      clients: { [WORKDIR]: client },
      default_client: client,
      ...(planner ? { planner: { [client]: planner } } : {}),
    },
    null,
    2,
  )}\n`;
}

/**
 * Write the container's obsidian.json to the host, outside the checkout.
 *
 * Outside on purpose: the session directory is mounted as the repo, so a
 * config written there would land in a working tree and could be committed.
 * This file names one client and belongs to no repository.
 */
export function writeObsidianConfig(
  session: Session,
  cwd: string,
): string | undefined {
  if (!existsSync(HOST_OBSIDIAN_CONFIG)) return undefined;
  let parsed: ObsidianConfig;
  try {
    parsed = JSON.parse(
      readFileSync(HOST_OBSIDIAN_CONFIG, "utf8"),
    ) as ObsidianConfig;
  } catch {
    // A malformed host config is the host's problem to fix; the container just
    // goes without rather than failing a launch over it.
    return undefined;
  }
  const body = buildObsidianConfig(parsed, cwd);
  if (!body) return undefined;
  mkdirSync(GENERATED, { recursive: true, mode: 0o700 });
  const path = join(GENERATED, `${session.container}.obsidian.json`);
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}

/**
 * Where shared instructions come from: the flag, the environment, or the
 * conventional path. Symlinks are resolved here rather than handed to the
 * container engine, which is inconsistent about following them.
 */
export function resolveStandards(explicit?: string): string | undefined {
  const path =
    explicit ?? process.env.CLAUDE_DOCKER_STANDARDS ?? STANDARDS_LINK;
  if (!existsSync(path)) {
    if (explicit) {
      throw new UserError(`No such directory: ${path}`);
    }
    return undefined;
  }
  const real = realpathSync(path);
  if (!statSync(real).isDirectory()) {
    throw new UserError(`Not a directory: ${path}`);
  }
  return real;
}

/**
 * No key yet. Carries the path so the caller can offer to create one there.
 *
 * A distinct type rather than a `UserError` because this is the one failure
 * with a good answer the tool can offer, instead of a message to act on.
 */
export class MissingKeyError extends Error {
  constructor(public readonly path: string) {
    super(`No SSH key at ${path}.`);
    this.name = "MissingKeyError";
  }
}

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
 *
 * Case is preserved. Ticket keys are conventionally uppercase, and the slug is
 * the branch name and the Remote Control session name, both of which people
 * read and search for — `feat/JIRA-12345` rather than `feat/jira-12345`.
 */
export function slugify(task: string): string {
  const slug = task
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
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
 * The task to use when none is given: the repository's own name.
 *
 * Running `claude-docker` bare is the "get me a container for this repo" case
 * rather than a mistake, so it names the session after the repo and reuses the
 * same checkout each time. Ticket-shaped tasks are still the normal way in; this
 * is the one you reach for when the work does not have a ticket yet.
 */
export function defaultTask(): string {
  const name = /\/([^/]+?)(?:\.git)?$/.exec(resolveRepo())?.[1];
  return name ?? basename(process.cwd());
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
    // The caller runs the guided setup instead. Creating a key is easy; getting
    // it onto an account that is not yours is the part worth walking through,
    // so this is not something to solve with a longer error message.
    throw new MissingKeyError(path);
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
    container:
      `claude-docker-${repoSlug(repo).replace(/\//g, "-")}-${slug}`.replace(
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

/**
 * The Remote Control session name.
 *
 * Prefixed so containerised work is distinguishable at a glance from a session
 * running on the machine itself, and suffixed with the branch so the session,
 * the branch, and the pull request all read as the same thing.
 */
export function remoteControlName(session: Session): string {
  return `@docker ${session.slug}`;
}

export interface RunOptions {
  session: Session;
  image: string;
  keyPath: string;
  gitName: string;
  gitEmail: string;
  /** Relax the container's seccomp profile so the inner sandbox can start. */
  sandbox: boolean;
  /** Host directory of shared instruction files, if one is configured. */
  standards?: string;
  /** Host directory of the Obsidian vault, if one is configured. */
  vault?: string;
  /** Mount the vault writable, so the container can write its own handover. */
  vaultWrite: boolean;
  /** Generated obsidian.json on the host, if one could be derived. */
  obsidianConfig?: string;
  /** Open a shell instead of starting Claude Code. */
  shell: boolean;
  /** Extra arguments passed through to `claude`. */
  passthrough: string[];
}

/** Which marketplace plugins this run installs. Vault skills need a vault. */
export function pluginList(vaultMounted: boolean): string[] {
  const configured = process.env.CLAUDE_DOCKER_PLUGINS;
  if (configured !== undefined) {
    return configured
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return vaultMounted ? [...BASE_PLUGINS, ...VAULT_PLUGINS] : [...BASE_PLUGINS];
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
    // Settings go in as *managed* settings, not user settings.
    //
    // The checkout is writable by design — that is the work — so a project-level
    // .claude/settings.local.json is always within reach. User settings lose to
    // it; managed settings cannot be overridden by anything, and the file is
    // root-owned inside a container running as `claude`. Mounted read-only so
    // it stays an ordinary host file you can edit, diff, and commit, while the
    // agent has no path to it at all.
    "--volume",
    `${SETTINGS_FILE}:${MANAGED_SETTINGS}:ro`,
    // Memory is advice, so the agent may reasonably rewrite it. It is still
    // mounted read-only: a change made inside would be invisible on the host
    // and silently discarded with the container.
    "--volume",
    `${MEMORY_FILE}:${CONTAINER_HOME}/.claude/CLAUDE.md:ro`,
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
    "--env",
    `CD_PLUGINS=${pluginList(Boolean(options.vault)).join(",")}`,
  ];

  // Shared instructions, so an `@standards/...` import in CLAUDE.md resolves.
  // Read-only: they are the same files your other sessions read, and a
  // container is not the place they should be edited from.
  if (options.standards) {
    args.push("--volume", `${options.standards}:${CONTAINER_STANDARDS}:ro`);
  }

  // The vault, so a handover written for this agent can actually be read.
  // Read-only unless --vault-write: see VAULT_LINK.
  if (options.vault) {
    args.push(
      "--volume",
      `${options.vault}:${CONTAINER_VAULT}${options.vaultWrite ? "" : ":ro"}`,
    );
  }

  // The derived vault/client mapping the obsidian and planner skills read.
  // Always read-only — it is generated per run, so an edit inside would be
  // discarded with the container.
  if (options.obsidianConfig) {
    args.push(
      "--volume",
      `${options.obsidianConfig}:${CONTAINER_OBSIDIAN_CONFIG}:ro`,
    );
  }

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

  // Remote Control is always on. A containerised task is an unattended task by
  // definition, and one you cannot watch from anywhere is one you will end up
  // babysitting from the terminal that started it.
  //
  // The permission mode is not passed here. It comes from the managed settings
  // file, which the container cannot edit — a CLI flag sits below managed
  // settings in the precedence order and would only be noise.
  args.push(
    options.image,
    "claude",
    "--remote-control",
    remoteControlName(session),
  );
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
 * Settings seeded on first use, mounted as the container's managed policy.
 *
 * Three things live here, in descending order of how much they matter.
 *
 * The permission floor. Auto mode rather than bypass: bypass explicitly skips
 * prompts for writes to `.claude`, `.git`, and friends, so it is incompatible
 * with protecting them. `disableBypassPermissionsMode` closes it for good, and
 * because this is a managed file nothing in the checkout can reopen it.
 *
 * The lock. `allowManagedPermissionRulesOnly` stops user and project settings
 * defining any rule, and `allowManagedHooksOnly` stops a cloned repo
 * registering a hook that would run a shell command on every tool call. Both
 * are managed-only settings: they have no effect anywhere else.
 *
 * The sandbox, off by default. A second, inner boundary: the container decides
 * what exists, the sandbox decides which domains a Bash command may reach.
 * Turning it on narrows egress and breaks anything missing from the list, which
 * should be a decision rather than a surprise, so it is pre-filled and off.
 */
const DEFAULT_SETTINGS = `{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",

  "//": [
    "Mounted read-only at ${MANAGED_SETTINGS} inside the claude-docker",
    "container, so it is Claude Code's managed policy: nothing in the cloned",
    "repo can override it. Edit it here on the host with 'claude-docker --config'."
  ],

  "//permissions": [
    "auto, never bypass. bypassPermissions skips prompts for writes to .claude,",
    ".git, .vscode and others, which is exactly what the deny rules below cover.",
    "Paths use the // absolute form on purpose: a bare '.claude/**' in a settings",
    "file resolves against that file's own directory, not the project."
  ],
  "permissions": {
    "defaultMode": "auto",
    "disableBypassPermissionsMode": "disable",
    "deny": [
      "Write(//**/.claude/**)",
      "Edit(//**/.claude/**)",
      "Read(//**/.env)",
      "Read(//**/*.pem)",
      "Read(//**/id_rsa)",
      "Read(//**/id_ed25519)"
    ]
  },

  "//managedOnly": [
    "These two are read from managed settings only. They are what stops the",
    "checkout — which the agent must be able to write — becoming a way to",
    "grant itself rules or run its own hooks.",
    "Hooks you want must therefore live in this file, not in the repo."
  ],
  "allowManagedPermissionRulesOnly": true,
  "allowManagedHooksOnly": true,

  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "/usr/local/bin/claude-docker-guard" }
        ]
      }
    ]
  },

  "//sandbox": [
    "Set sandbox.enabled to true to narrow egress to allowedDomains below.",
    "It covers Bash commands and their children — not WebFetch or MCP, which",
    "follow permission rules instead. deniedDomains always beats allowedDomains.",
    "network.strictAllowlist denies an unlisted host outright; without it the",
    "sandbox prompts for one, which nobody is present to answer unattended.",
    "enableWeakerNestedSandbox is required for a sandbox inside a container:",
    "bubblewrap cannot mount a fresh /proc unprivileged. It weakens the inner",
    "boundary, which is acceptable only because the container is the outer one.",
    "excludedCommands is where docker goes if a task needs it: docker and the",
    "sandbox are incompatible.",
    "Do not add comment keys inside sandbox or network. Both are strict, and",
    "one unknown key makes Claude Code discard the entire block."
  ],

  "sandbox": {
    "enabled": false,
    "enableWeakerNestedSandbox": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": [],
    "network": {
      "strictAllowlist": true,
      "allowedDomains": [
        "api.anthropic.com",
        "registry.npmjs.org",
        "github.com",
        "*.githubusercontent.com"
      ],
      "deniedDomains": [],
      "allowUnixSockets": [],
      "allowLocalBinding": true
    }
  }
}
`;

/**
 * Memory seeded on first use. Applies to every task in every container.
 *
 * The import matters more than it looks. A `~/.claude/CLAUDE.md` on the host
 * usually pulls in standards from a repo by absolute path, and that path does
 * not exist in the container — so without this the agent loses every standing
 * instruction you have, silently, and you notice it as the agent behaving
 * unlike itself rather than as a missing file.
 */
const DEFAULT_MEMORY = `# claude-docker

Global memory for every task run by \`claude-docker\`. Per-repo \`CLAUDE.md\`
files in the cloned checkout still apply and are read after this one.

@standards/CLAUDE.md

## Where you are

You are in a container holding one repository, on one branch, cloned for a
single task. Nothing else of the user's machine is reachable. Sessions run in
auto mode; bypass is disabled and the permission rules come from a managed
settings file you cannot edit. Push the task branch; never push to the default
branch.

## Handovers

You were not in the conversation that set this task up, so do not infer what was
decided. If an Obsidian vault is mounted at \`~/vault\`, look there **first** for
a handover note covering this work — \`Clients/<Client>/Handover — <topic>, <date>.md\`
— and follow it before forming your own plan. It carries the constraints, the
traps, what is already done, and which beliefs turned out wrong.

The vault is read-only unless the container was started with \`--vault-write\`.
Anything the note marks *needs an operator decision* is not yours to start.

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
  if (!existsSync(SETTINGS_FILE))
    writeFileSync(SETTINGS_FILE, DEFAULT_SETTINGS);
  if (!existsSync(MEMORY_FILE)) writeFileSync(MEMORY_FILE, DEFAULT_MEMORY);
}
