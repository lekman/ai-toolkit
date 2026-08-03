/**
 * The container image, and the entrypoint that fills it with a repo.
 *
 * Both live here as strings rather than as files on disk, because the package
 * is published as a single bundled `dist/cli.js` — anything shipped alongside
 * it would have to be found at runtime, and a published CLI has no reliable
 * idea where it was installed.
 *
 * The image is tagged with a hash of its own definition, so changing anything
 * below produces a new tag and the next run rebuilds. No `--rebuild` needed to
 * pick up an edit, and no stale image silently in use.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { docker, dockerInherit, UserError } from "./engine.js";

/** The user inside the container. Never root — see the Dockerfile comment. */
export const CONTAINER_USER = "claude";
export const CONTAINER_UID = 1001;
export const CONTAINER_HOME = `/home/${CONTAINER_USER}`;
/** Where the repo is cloned, inside the container. */
export const WORKDIR = "/work";

/**
 * Clone on first run, then hand over to Claude Code.
 *
 * The clone happens here rather than on the host so that nothing outside the
 * container ever needs the dedicated key, and so the working copy is built
 * from the remote rather than copied out of your own checkout — no local
 * branches, no stashes, no untracked files come along.
 */
const ENTRYPOINT = `#!/usr/bin/env bash
set -euo pipefail

: "\${CD_REPO:?no repository given}"
: "\${CD_BRANCH:?no branch given}"

export GIT_SSH_COMMAND="ssh -i ${CONTAINER_HOME}/.ssh/id_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"

git config --global user.name "\${CD_GIT_NAME}"
git config --global user.email "\${CD_GIT_EMAIL}"
git config --global --add safe.directory ${WORKDIR}

if [ ! -d "${WORKDIR}/.git" ]; then
  echo "[claude-docker] cloning \${CD_REPO}"
  # A blobless clone keeps full history for log and blame while skipping file
  # contents until something asks for them. Much faster on a large repo, and
  # unlike --depth it does not break rebasing or pushing.
  git clone --filter=blob:none --origin origin "\${CD_REPO}" "${WORKDIR}"
  cd "${WORKDIR}"
  if git show-ref --verify --quiet "refs/remotes/origin/\${CD_BRANCH}"; then
    echo "[claude-docker] checking out existing branch \${CD_BRANCH}"
    git checkout -q "\${CD_BRANCH}"
  else
    echo "[claude-docker] creating branch \${CD_BRANCH} from \${CD_BASE}"
    git checkout -q -b "\${CD_BRANCH}" "origin/\${CD_BASE}"
  fi
else
  cd "${WORKDIR}"
fi

exec "$@"
`;

/**
 * Debian rather than Alpine: Claude Code and much of what an agent reaches for
 * assume glibc, and a musl surprise mid-session is a poor trade for a smaller
 * image.
 *
 * The non-root user is not a hardening nicety. Claude Code refuses
 * `--dangerously-skip-permissions` outright when running as root, and bypassing
 * permissions is the default here, so a root image would not start at all.
 */
const DOCKERFILE = `FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \\
      ca-certificates \\
      curl \\
      git \\
      gnupg \\
      jq \\
      less \\
      openssh-client \\
      procps \\
      ripgrep \\
      unzip \\
      bubblewrap \\
      socat \\
    && rm -rf /var/lib/apt/lists/*

# The sandbox runtime supplies the seccomp filter that blocks Unix domain
# sockets. Optional, but without it the sandbox's isolation is weaker in exactly
# the place that matters here — a reachable docker socket is a way out.
RUN npm install -g @anthropic-ai/claude-code @anthropic-ai/sandbox-runtime \\
    && npm cache clean --force

# Baked in so a first clone never stops on an interactive host-key prompt,
# which in a non-interactive container reads as a hang.
RUN mkdir -p /etc/ssh && ssh-keyscan -t rsa,ecdsa,ed25519 github.com > /etc/ssh/ssh_known_hosts 2>/dev/null

RUN useradd --create-home --uid ${CONTAINER_UID} --shell /bin/bash ${CONTAINER_USER} \\
    && mkdir -p ${WORKDIR} ${CONTAINER_HOME}/.claude \\
    && chown -R ${CONTAINER_USER}:${CONTAINER_USER} ${WORKDIR} ${CONTAINER_HOME}

COPY entrypoint.sh /usr/local/bin/claude-docker-entrypoint
RUN chmod 0755 /usr/local/bin/claude-docker-entrypoint

USER ${CONTAINER_USER}
WORKDIR ${WORKDIR}
ENV CLAUDE_CODE_DISABLE_AUTOUPDATER=1
ENTRYPOINT ["/usr/local/bin/claude-docker-entrypoint"]
`;

/** Tag derived from the definition, so an edit here invalidates the build. */
export function imageTag(): string {
  const hash = createHash("sha256")
    .update(DOCKERFILE)
    .update(ENTRYPOINT)
    .digest("hex")
    .slice(0, 12);
  return `claude-docker:${hash}`;
}

/** Is the tagged image already built? */
export function imageExists(tag: string): boolean {
  return docker(["image", "inspect", tag, "--format", "{{.Id}}"]) !== undefined;
}

/**
 * Build the image, feeding the context in over stdin.
 *
 * A tar on stdin avoids writing a build directory anywhere on the host, which
 * keeps the whole thing to one temporary construct that docker consumes and
 * discards.
 */
export async function buildImage(tag: string): Promise<void> {
  console.error(`[claude-docker] building ${tag} (first run takes a minute)`);

  // A minimal uncompressed tar, written by hand: two small files do not justify
  // a dependency, and this keeps the published bundle free of one.
  const context = tar([
    { name: "Dockerfile", body: DOCKERFILE, mode: 0o644 },
    { name: "entrypoint.sh", body: ENTRYPOINT, mode: 0o755 },
  ]);

  const result = spawnSync("docker", ["build", "-t", tag, "-"], {
    input: context,
    stdio: ["pipe", "inherit", "inherit"],
    timeout: 900_000,
  });
  if (result.status !== 0) {
    throw new UserError(
      `Building the image failed.\nRerun with --rebuild once the cause is fixed.`,
    );
  }
}

/** Remove every image this tool has built. Used by --clean. */
export async function pruneImages(): Promise<number> {
  const listed = docker([
    "images",
    "claude-docker",
    "--format",
    "{{.Repository}}:{{.Tag}}",
  ]);
  const tags = (listed ?? "").split("\n").filter(Boolean);
  if (tags.length === 0) return 0;
  await dockerInherit(["image", "rm", "-f", ...tags]);
  return tags.length;
}

interface TarEntry {
  name: string;
  body: string;
  mode: number;
}

/** A ustar archive holding a handful of small text files. */
function tar(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body, "utf8");
    const header = Buffer.alloc(512);

    const write = (value: string, offset: number, length: number): void => {
      header.write(value.slice(0, length - 1), offset, "ascii");
    };
    const octal = (value: number, offset: number, length: number): void => {
      write(value.toString(8).padStart(length - 1, "0"), offset, length);
    };

    write(entry.name, 0, 100);
    octal(entry.mode, 100, 8);
    octal(0, 108, 8); // uid
    octal(0, 116, 8); // gid
    octal(body.length, 124, 12);
    octal(0, 136, 12); // mtime: fixed, so the same input builds the same context
    header.write("0", 156, "ascii"); // regular file
    // Magic and version are separate fields with a NUL between them, and
    // are written separately so no NUL byte has to sit in this source file
    // — one embedded here makes git treat the whole file as binary.
    header.write("ustar", 257, "ascii");
    header.write("00", 263, "ascii");

    // The checksum is computed with its own field read as spaces, then written
    // back into that field. Order matters.
    header.write(" ".repeat(8), 148, "ascii");
    let sum = 0;
    for (const byte of header) sum += byte;
    write(sum.toString(8).padStart(6, "0"), 148, 8);
    header.write("\0 ", 154, "ascii");

    blocks.push(header, body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  // Two empty blocks end the archive.
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
