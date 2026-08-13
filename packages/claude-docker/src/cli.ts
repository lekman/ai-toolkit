#!/usr/bin/env node
/**
 * claude-docker — run one Claude Code task in a container that holds nothing
 * but that task.
 *
 * An agent useful for a long unattended task is also one that can reach every
 * repo, key, and credential your user can. The usual answer is to approve each
 * tool call, which defeats the point of leaving it running.
 *
 * The answer here is a boundary instead of a prompt. The container clones one
 * repo, on one branch, using a key that belongs to a separate account, and
 * mounts nothing else of yours. Inside it, sessions run in auto mode with
 * bypass disabled and the permission rules held in a managed settings file the
 * container cannot edit, so the guard rails do not depend on the agent leaving
 * them alone. Remote Control means you can watch it from anywhere.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import pc from "picocolors";

import {
  dockerInherit,
  ensureEngine,
  run,
  UserError,
  which,
} from "./lib/engine.js";
import { buildImage, imageExists, imageTag, pruneImages } from "./lib/image.js";
import {
  ghAccounts,
  keyAccount,
  setupKey,
  verifiedAccount,
} from "./lib/key.js";
import {
  CONFIG_VOLUME,
  DEFAULT_KEY,
  defaultTask,
  ensureConfigFiles,
  ensureConfigVolume,
  isCloned,
  listSessions,
  MEMORY_FILE,
  MissingKeyError,
  pluginList,
  prepare,
  remoteControlName,
  resolveKey,
  resolveStandards,
  resolveVault,
  ROOT,
  runArgs,
  sandboxEnabled,
  SETTINGS_FILE,
  STANDARDS_LINK,
  VAULT_LINK,
  writeObsidianConfig,
} from "./lib/session.js";

// package.json sits one level above both src/ (dev) and dist/ (published), so
// the version can never drift from what npm shows.
const VERSION = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

const HELP = `
${pc.bold("claude-docker")} — run one Claude Code task in an isolated container

  claude-docker                    check the setup, then start on this repo
  claude-docker <task>             clone the repo and start work on <task>
  claude-docker --setup-key        create the clone key and attach it to an account
  claude-docker --config           edit the container's settings.json and CLAUDE.md
  claude-docker --status           engine, image, and sessions; changes nothing
  claude-docker --clean            remove built images ${pc.dim("(the config volume is kept)")}

${pc.dim("The task name is normally a ticket. It names the branch, the container,")}
${pc.dim("the session directory, and the Remote Control session. Left out, the")}
${pc.dim("repository's own name is used and the same checkout is reused.")}

  --repo <url>       repository to clone ${pc.dim("(default: origin of the current repo)")}
  --base <branch>    branch to start from ${pc.dim("(default: the remote's HEAD)")}
  --ssh-key <path>   key to clone with ${pc.dim(`(default: ${DEFAULT_KEY})`)}
  --standards <dir>  shared instruction files, mounted read-only ${pc.dim(`(default: ${STANDARDS_LINK})`)}
  --vault <dir>      Obsidian vault, mounted read-only ${pc.dim(`(default: ${VAULT_LINK})`)}
  --vault-write      mount the vault writable ${pc.dim("(the container can write handovers back)")}
  --git-name <name>  commit author name
  --git-email <addr> commit author email
  --shell            open a shell in the container instead of Claude Code
  --rm               delete the session directory afterwards
  --no-start         fail rather than starting the container engine
  --rebuild          rebuild the image before starting

  --help, -h       this text
  --version

${pc.dim("Anything after -- is passed to claude untouched:")}
  claude-docker PROJ-123 -- --model opus
`;

interface Args {
  task?: string;
  status: boolean;
  clean: boolean;
  config: boolean;
  setupKey: boolean;
  standards?: string;
  vault?: string;
  vaultWrite: boolean;
  start: boolean;
  rebuild: boolean;
  shell: boolean;
  remove: boolean;
  repo?: string;
  base?: string;
  sshKey?: string;
  gitName: string;
  gitEmail: string;
  passthrough: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    status: false,
    clean: false,
    config: false,
    setupKey: false,
    vaultWrite: false,
    start: true,
    rebuild: false,
    shell: false,
    remove: false,
    gitName: process.env.CLAUDE_DOCKER_GIT_NAME ?? "claude-docker",
    gitEmail: process.env.CLAUDE_DOCKER_GIT_EMAIL ?? "claude-docker@localhost",
    passthrough: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      args.passthrough = argv.slice(i + 1);
      break;
    }
    if (arg === "--status") args.status = true;
    else if (arg === "--config") args.config = true;
    else if (arg === "--setup-key") args.setupKey = true;
    else if (arg === "--standards") args.standards = argv[++i];
    else if (arg === "--vault") args.vault = argv[++i];
    else if (arg === "--vault-write") args.vaultWrite = true;
    else if (arg === "--clean") args.clean = true;
    else if (arg === "--no-start") args.start = false;
    else if (arg === "--rebuild") args.rebuild = true;
    else if (arg === "--shell") args.shell = true;
    else if (arg === "--rm") args.remove = true;
    else if (arg === "--permissions" || arg === "--no-permissions") {
      throw new UserError(
        `${arg} was removed. Sessions always run in auto mode now.\n\n` +
          `  Bypass mode skips prompts for writes to .claude and .git, which is\n` +
          `  what the container's managed permission rules exist to stop, so the\n` +
          `  two cannot both be true. Bypass is disabled in the managed settings\n` +
          `  file and cannot be re-enabled from inside the container.\n\n` +
          `  Edit the rules with: claude-docker --config`,
      );
    } else if (arg === "--no-remote-control") {
      throw new UserError(
        `--no-remote-control was removed. Remote Control is always on.\n\n` +
          `  A containerised task is an unattended task, and the session is named\n` +
          `  after its branch so you can find it: "@docker <branch>".`,
      );
    } else if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--base") args.base = argv[++i];
    else if (arg === "--ssh-key") args.sshKey = argv[++i];
    else if (arg === "--git-name") args.gitName = argv[++i] ?? args.gitName;
    else if (arg === "--git-email") args.gitEmail = argv[++i] ?? args.gitEmail;
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--version") {
      console.log(VERSION);
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new UserError(
        `Unknown option ${arg}. Pass options for claude after --:\n` +
          `  claude-docker <task> -- ${arg}`,
      );
    } else if (!args.task) args.task = arg;
    else {
      throw new UserError(
        `Only one task name is expected, and "${args.task}" was already given.\n` +
          `Quote it if the name has spaces: claude-docker "${args.task} ${arg}"`,
      );
    }
  }
  return args;
}

async function status(args: Args): Promise<void> {
  console.log(pc.bold("\nclaude-docker\n"));

  const engine = await ensureEngine({ start: false }).catch(
    (error: unknown) => error as UserError,
  );
  if (engine instanceof Error) {
    console.log(`  engine   ${pc.yellow("not running")}`);
    console.log(pc.dim(`           ${engine.message.split("\n")[0]}`));
  } else {
    console.log(`  engine   ${engine.provider} ${pc.dim(engine.version)}`);
  }

  const tag = imageTag();
  const built = !(engine instanceof Error) && imageExists(tag);
  console.log(
    `  image    ${tag} ${built ? pc.green("built") : pc.dim("not built")}`,
  );

  const key = args.sshKey ?? DEFAULT_KEY;
  let keyState = pc.yellow("missing");
  try {
    resolveKey(args.sshKey);
    keyState = pc.green("present");
  } catch {
    // Reported as missing; --status never creates anything.
  }
  console.log(`  ssh key  ${key} ${keyState}`);

  // Who the key belongs to is the thing worth knowing, and the only way to
  // learn it is to ask GitHub. Skipped when there is no key to ask about.
  if (keyState !== pc.yellow("missing")) {
    const account = await keyAccount(key);
    const mine = ghAccounts();
    const own = account && mine?.some((a) => a.login === account);
    console.log(
      `  account  ` +
        (account
          ? own
            ? pc.yellow(`${account} — signed in here, not isolated`)
            : pc.green(account)
          : pc.yellow("not registered with GitHub")),
    );
  }

  let standards: string | undefined;
  try {
    standards = resolveStandards(args.standards);
  } catch {
    // A bad path is reported at launch, not here.
  }
  console.log(
    `  standards ${standards ?? pc.dim(`none (link ${STANDARDS_LINK.replace(homedir(), "~")})`)}`,
  );

  let vault: string | undefined;
  try {
    vault = resolveVault(args.vault);
  } catch {
    // A bad path is reported at launch, not here.
  }
  console.log(
    `  vault    ` +
      (vault
        ? `${vault} ${args.vaultWrite ? pc.yellow("writable") : pc.dim("read-only")}`
        : pc.dim(`none (link ${VAULT_LINK.replace(homedir(), "~")})`)),
  );
  console.log(`  plugins  ${pluginList(Boolean(vault)).join(", ")}`);

  console.log(
    `  config   ${SETTINGS_FILE} ` +
      (existsSync(SETTINGS_FILE)
        ? pc.green("present")
        : pc.dim("not yet written")),
  );
  console.log(
    `           ${MEMORY_FILE} ` +
      (existsSync(MEMORY_FILE)
        ? pc.green("present")
        : pc.dim("not yet written")),
  );

  const sessions = listSessions();
  console.log(`\n  ${pc.bold("Sessions")}\n`);
  if (sessions.length === 0) {
    console.log(pc.dim("  (none)"));
  } else {
    for (const one of sessions) {
      console.log(`  ${one.repo.padEnd(28)} ${one.task}`);
      console.log(pc.dim(`    ${one.dir}`));
    }
  }
  console.log();
}

/**
 * Open the container's global config for editing.
 *
 * Both files live on the host and are mounted into the container, so this is an
 * ordinary editor on ordinary files rather than an exec into a running
 * container. `code` is preferred because it opens both at once and returns
 * immediately; anything else falls back to $EDITOR, opened one at a time.
 */
async function config(): Promise<void> {
  ensureConfigFiles();
  const files = [SETTINGS_FILE, MEMORY_FILE];

  if (which("code")) {
    await run("code", files);
    console.log(`Opened in VS Code:\n  ${files.join("\n  ")}`);
    return;
  }

  const editor = process.env.VISUAL ?? process.env.EDITOR;
  if (!editor) {
    console.log(
      `Neither \`code\` nor $EDITOR is available. Edit these directly:\n\n` +
        `  ${files.join("\n  ")}\n`,
    );
    return;
  }
  for (const file of files) await run(editor, [file]);
}

async function clean(): Promise<void> {
  await ensureEngine({ start: false });
  const removed = await pruneImages();
  console.log(
    removed
      ? `Removed ${removed} image${removed === 1 ? "" : "s"}.`
      : "No images to remove.",
  );
  console.log(
    pc.dim(
      `The config volume ${CONFIG_VOLUME} holds your container login and is kept.\n` +
        `Remove it with: docker volume rm ${CONFIG_VOLUME}\n` +
        `Session checkouts are under ${ROOT} and are kept too.`,
    ),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.config) return config();
  if (args.status) return status(args);
  if (args.clean) return clean();
  if (args.setupKey) {
    await setupKey(args.sshKey ?? DEFAULT_KEY);
    return;
  }

  if (!which("git")) {
    throw new UserError("git is required and is not on your PATH.");
  }

  // No task means "a container for this repo", not a mistake. The repository's
  // own name becomes the task, so the checkout is reused each time rather than
  // a new one appearing per invocation.
  const task = args.task ?? defaultTask();

  // The key comes first, because it is the one failure that would otherwise
  // surface several seconds into a clone as an SSH error that never mentions
  // the key. Both halves are checked: that a key exists, and that GitHub knows
  // it. The second answer is cached against the key's mtime, so this is a
  // round trip once rather than on every launch.
  let keyPath: string;
  try {
    keyPath = resolveKey(args.sshKey);
  } catch (error: unknown) {
    if (!(error instanceof MissingKeyError)) throw error;
    if (!process.stdin.isTTY) {
      throw new UserError(
        `${error.message}\n` +
          `Run \`claude-docker --setup-key\` from a terminal to create one.`,
      );
    }
    await setupKey(error.path);
    keyPath = resolveKey(args.sshKey);
  }

  if (!(await verifiedAccount(keyPath))) {
    if (!process.stdin.isTTY) {
      throw new UserError(
        `GitHub does not recognise the key at ${keyPath}, so the clone would fail.\n` +
          `Run \`claude-docker --setup-key\` from a terminal to attach it.`,
      );
    }
    console.error(
      pc.yellow(
        `[claude-docker] GitHub does not recognise ${keyPath}. Setting it up.`,
      ),
    );
    keyPath = await setupKey(keyPath);
  }

  const session = prepare({
    task,
    repo: args.repo,
    base: args.base,
  });

  await ensureEngine({ start: args.start });

  const tag = imageTag();
  if (args.rebuild || !imageExists(tag)) await buildImage(tag);
  ensureConfigVolume();
  ensureConfigFiles();

  // Read after seeding, so a first run sees the file that was just written.
  const sandbox = sandboxEnabled();
  const standards = resolveStandards(args.standards);
  const vault = resolveVault(args.vault);
  // Derived from the host config before the container starts, and only when a
  // vault is mounted — without one the skills have nothing to read.
  const obsidianConfig = vault
    ? writeObsidianConfig(session, process.cwd())
    : undefined;

  console.error(
    pc.dim(
      `[claude-docker] ${session.repo} → ${session.slug}` +
        (isCloned(session)
          ? " (existing checkout)"
          : ` (new, from ${session.base})`),
    ),
  );
  console.error(
    pc.dim(
      `[claude-docker] auto mode, bypass disabled — rules and hooks come from` +
        ` the managed settings file and cannot be changed from inside.`,
    ),
  );
  console.error(
    pc.dim(
      `[claude-docker] remote control session "${remoteControlName(session)}"`,
    ),
  );
  if (standards) {
    console.error(pc.dim(`[claude-docker] standards from ${standards}`));
  } else {
    console.error(
      pc.dim(
        `[claude-docker] no standards mounted — CLAUDE.md's @standards import` +
          ` will resolve to nothing. See --standards.`,
      ),
    );
  }
  if (vault) {
    console.error(
      pc.dim(
        `[claude-docker] vault ${args.vaultWrite ? "writable" : "read-only"} from ${vault}` +
          (obsidianConfig
            ? ""
            : " — no client resolved, obsidian.json not generated"),
      ),
    );
    if (args.vaultWrite) {
      console.error(
        pc.yellow(
          `[claude-docker] the whole vault is writable from inside this container.`,
        ),
      );
    }
  }
  console.error(
    pc.dim(
      `[claude-docker] plugins ${pluginList(Boolean(vault)).join(", ")} from the baked marketplace`,
    ),
  );
  if (sandbox) {
    console.error(
      pc.dim(
        `[claude-docker] sandbox on — running with seccomp=unconfined so` +
          ` bubblewrap can start. Egress follows sandbox.network in settings.json.`,
      ),
    );
  }

  const code = await dockerInherit(
    runArgs({
      session,
      image: tag,
      keyPath,
      gitName: args.gitName,
      gitEmail: args.gitEmail,
      sandbox,
      standards,
      vault,
      vaultWrite: args.vaultWrite,
      obsidianConfig,
      shell: args.shell,
      passthrough: args.passthrough,
    }),
  );

  if (args.remove) {
    rmSync(session.dir, { recursive: true, force: true });
    console.error(pc.dim(`[claude-docker] removed ${session.dir}`));
  } else {
    console.error(pc.dim(`[claude-docker] checkout kept at ${session.dir}`));
  }
  process.exit(code);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${pc.red("error:")} ${message}`);
  process.exit(1);
});
