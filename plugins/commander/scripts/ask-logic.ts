/**
 * ask-logic — the pure rules behind the ask and delivery hooks: how a
 * session is addressed, which client it works for, whether it has opted
 * out, what goes to Atlas, and the text the agent reads. No file, process
 * or network access here; `ask.system.ts` does the I/O.
 */

/** The ask configuration, `ask.json` in the Claude configuration folder. Every field is optional. */
export interface AskConfig {
  /** Text for where a card-only client keeps its questions, by client id. */
  askIn?: Record<string, string>;
  /** Atlas's MCP address, when `ATLAS_MCP_URL` is not set. */
  atlasUrl?: string;
  /** Client ids whose questions leave as a card only: no text. */
  cardOnly?: string[];
  /** The client when no folder matches. */
  client?: string;
  /** Folder prefix to client id. */
  clients?: Record<string, string>;
  /** `off` keeps `AskUserQuestion` in every session on this machine. */
  hook?: "off" | "on";
  /** A link pattern back to a card's task, by client id. `{task}` is the task id. */
  links?: Record<string, string>;
  /** Session names that keep `AskUserQuestion`, matched as a prefix. */
  optOut?: string[];
  /** `false` turns the background watcher off on this machine. */
  watch?: boolean;
}

/** One question as `AskUserQuestion` takes it, and as Atlas stores it. */
export interface AskedQuestion {
  header?: string;
  multiSelect?: boolean;
  options: { description?: string; label: string }[];
  question: string;
}

/** Everything the hook knows about the asking session. */
export interface AskContext {
  account: string;
  addresses: string[];
  clientId: null | string;
  config: AskConfig;
  host: string;
  sessionId: string;
  taskId: null | string;
}

/** The `ask_question` input Atlas takes. */
export interface AtlasAsk {
  cardOnly?: boolean;
  clientId?: string;
  link?: string;
  questions: AskedQuestion[];
  session: {
    account?: string;
    address: string;
    host?: string;
    sessionId?: string;
  };
  taskId?: string;
  title?: string;
}

/** A message from the tasks server's inbox. */
export interface InboxMessage {
  createdAt: string;
  deliveredAt?: string;
  from: string;
  id: string;
  text: string;
  to: string;
}

/** The parts of `~/.claude/obsidian.json` that name clients by folder. */
export interface ObsidianClients {
  clients?: Record<string, string>;
  default_client?: string;
}

/** A Claude Code session record, `<config folder>/sessions/<pid>.json`. */
export interface SessionRecord {
  cwd?: string;
  name?: string;
  nameSource?: string;
  pid?: number;
  sessionId: string;
}

/** The skill agents use to ask without the detour through the hook. */
export const SKILL = "commander:ask";

/** The title a card carries: written for outside use, with nothing from the client. */
export const CARD_TITLE = "A question waits in the client's own tools";

const OFF = ["0", "false", "no", "off"];

/** The account a configuration folder belongs to: its name without `.claude-`, or `default` for `~/.claude` and when none is set. */
export function accountOf(configDir: string | undefined, home: string): string {
  const folder = (configDir ?? "").replace(/\/+$/, "");
  if (!folder || folder === `${home}/.claude`) return "default";
  const base = folder.split("/").pop() ?? "";
  return address(base.replace(/^\.?claude-?/, "")) ?? "default";
}

/**
 * A session's addresses, the one it is known by first. A name the person
 * gave (or `--name` on the command line) is the address; an automatic title
 * changes as the session works, so such a session goes by its id address.
 * The id address is always included, so a message to either form arrives.
 */
export function addressesOf(
  sessionId: string,
  record: null | Pick<SessionRecord, "name" | "nameSource">,
  processName: null | string,
): string[] {
  const given =
    record?.name && record.nameSource !== "auto" ? address(record.name) : null;
  const primary = given ?? (processName ? address(processName) : null);
  const own = idAddress(sessionId);
  return primary && primary !== own ? [primary, own] : [own];
}

/** A name in the tasks server's form: lower-case words joined by hyphens, at most 96 characters. */
export function address(name: string): null | string {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]/)
    .filter(Boolean)
    .join("-")
    .slice(0, 96);
  let end = words.length;
  while (end > 0 && words[end - 1] === "-") end -= 1;
  return words.slice(0, end) || null;
}

/** Where a card-only client keeps its questions, in the agent's words. */
export function askInText(
  context: Pick<AskContext, "clientId" | "config">,
): string {
  return (
    (context.clientId ? context.config.askIn?.[context.clientId] : undefined) ??
    "where the client's own tools keep questions, such as a comment on the task's ticket"
  );
}

/**
 * The `ask_question` input for Atlas. A card carries the fixed title, the
 * task and a link from the configuration's pattern, and never the question.
 */
export function atlasAsk(
  context: AskContext,
  questions: AskedQuestion[],
  title?: string,
): AtlasAsk {
  const session = {
    address: context.addresses[0]!,
    sessionId: context.sessionId,
    account: context.account,
    host: context.host,
  };
  const base = {
    session,
    ...(context.clientId ? { clientId: context.clientId } : {}),
    ...(context.taskId ? { taskId: context.taskId } : {}),
  };
  if (!isCardOnly(context))
    return { ...base, questions, ...(title ? { title } : {}) };
  const pattern = context.clientId
    ? context.config.links?.[context.clientId]
    : undefined;
  const link =
    pattern && context.taskId
      ? pattern.replaceAll("{task}", encodeURIComponent(context.taskId))
      : undefined;
  return {
    ...base,
    cardOnly: true,
    title: CARD_TITLE,
    questions: [],
    ...(link?.startsWith("https://") ? { link } : {}),
  };
}

/**
 * The client a session works for, as a tasks client id. The ask
 * configuration's folders come first, then the dashboard's (whose client
 * names become ids), then the ask configuration's `client`, then the
 * dashboard's default. Null when nothing names one.
 */
export function clientOf(
  cwd: string,
  config: AskConfig,
  obsidian: ObsidianClients,
): null | string {
  const named =
    longestPrefix(cwd, config.clients) ??
    longestPrefix(cwd, obsidian.clients) ??
    config.client ??
    obsidian.default_client;
  return named ? address(named) : null;
}

/** The refusal after Atlas took the question: automated, the skill, and keep working. */
export function convertedReason(
  questionId: string,
  cardOnly: boolean,
  context: Pick<AskContext, "clientId" | "config">,
  askScript: string,
): string {
  const skill = `Next time ask with the ${SKILL} skill (\`bun ${askScript} ask --question "..." --option "..."\`), which does the same at once.`;
  if (cardOnly)
    return [
      "Automated by the commander plugin's ask hook.",
      `This session's client keeps questions inside its own tools, so the question was not sent anywhere. Atlas has only a card (${questionId}) with no text, so the owner knows a question waits.`,
      `Write the question ${askInText(context)}, then keep working on what does not depend on the answer.`,
      "When the owner has answered there, a message tells this session; read the answer in the client's tools.",
      skill,
    ].join(" ");
  return [
    "Automated by the commander plugin's ask hook.",
    `This AskUserQuestion call was sent to the owner as Atlas question ${questionId}, so nothing waits on it here.`,
    "Keep working on what does not depend on the answer.",
    "The answer arrives in this session as a message, which a hook shows you, even if this session is idle by then.",
    "If nothing can go on without it, say so and end your turn.",
    skill,
  ].join(" ");
}

/** What a hook event prints for new messages, or null when it prints nothing. */
export function deliveryOutput(
  event: string,
  text: string,
): null | Record<string, unknown> {
  if (event === "Stop") return { decision: "block", reason: text };
  if (event === "SessionStart" || event === "UserPromptSubmit")
    return {
      hookSpecificOutput: { additionalContext: text, hookEventName: event },
    };
  return null;
}

/** The address that is always this session's own: `session-` and the start of its id. */
export function idAddress(sessionId: string): string {
  const head = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return `session-${head || "unknown"}`;
}

/** Whether a session's client keeps its questions inside its own tools. */
export function isCardOnly(
  context: Pick<AskContext, "clientId" | "config">,
): boolean {
  return (
    context.clientId !== null &&
    (context.config.cardOnly ?? []).some(
      (id) => address(id) === context.clientId,
    )
  );
}

/** Whether a session name falls under one of `prefixes`: equal, or followed by a hyphen. */
export function matchesPrefix(
  sessionAddress: string,
  prefixes: readonly string[],
): boolean {
  return prefixes.some((prefix) => {
    const p = address(prefix);
    return (
      p !== null && (sessionAddress === p || sessionAddress.startsWith(`${p}-`))
    );
  });
}

/** The messages as the agent reads them. */
export function messagesText(
  messages: readonly InboxMessage[],
  sessionAddress: string,
): string {
  const lines = [
    `${messages.length === 1 ? "A message" : `${messages.length} messages`} for this session (${sessionAddress}), delivered by the commander plugin's hook. An answer from the owner settles the question it names; act on it now if it changes what you are doing.`,
  ];
  for (const message of messages)
    lines.push("", `From ${message.from}, ${message.createdAt}:`, message.text);
  lines.push(
    "",
    `Reply to another agent with the ${SKILL} skill's message command, or the tasks server's message_send, using the name after "From".`,
  );
  return lines.join("\n");
}

/** Why a session keeps `AskUserQuestion`, or null when the hook converts it. */
export function optedOut(
  env: Record<string, string | undefined>,
  config: AskConfig,
  addresses: readonly string[],
): null | string {
  if (OFF.includes((env.ASK_HOOK ?? "").trim().toLowerCase()))
    return "ASK_HOOK is off";
  if (config.hook === "off") return "the ask configuration turns the hook off";
  if (addresses.some((a) => matchesPrefix(a, config.optOut ?? [])))
    return "the session's name is on the opt-out list";
  return null;
}

/**
 * The questions from an `AskUserQuestion` call, in the shape Atlas takes:
 * at most four, each with at most eight options, every text cut to its
 * limit. A question with no text is dropped.
 */
export function questionsFrom(toolInput: unknown): AskedQuestion[] {
  const raw = (toolInput as null | { questions?: unknown })?.questions;
  if (!Array.isArray(raw)) return [];
  const out: AskedQuestion[] = [];
  for (const item of raw.slice(0, 4)) {
    const question = cut(item?.question, 1000);
    if (!question) continue;
    const options: AskedQuestion["options"] = [];
    for (const option of Array.isArray(item?.options)
      ? item.options.slice(0, 8)
      : []) {
      const label = cut(option?.label, 200);
      const description = cut(option?.description, 500);
      if (label)
        options.push({ label, ...(description ? { description } : {}) });
    }
    const header = cut(item?.header, 60);
    out.push({
      question,
      ...(header ? { header } : {}),
      options,
      ...(item?.multiSelect === true ? { multiSelect: true } : {}),
    });
  }
  return out;
}

/** New messages: not yet shown to this session and not delivered elsewhere, oldest first, each once. */
export function unseen(
  messages: readonly InboxMessage[],
  seen: ReadonlySet<string>,
): InboxMessage[] {
  const out = new Map<string, InboxMessage>();
  for (const message of messages)
    if (!seen.has(message.id) && !message.deliveredAt)
      out.set(message.id, message);
  return [...out.values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** Whether a watcher keeps polling: its session lives, it is still the session's watcher, and its time is not up. */
export function watchGoesOn(state: {
  deadline: number;
  myPid: number;
  now: number;
  ownerPid: null | number;
  sessionAlive: boolean;
}): boolean {
  return (
    state.sessionAlive &&
    state.ownerPid === state.myPid &&
    state.now < state.deadline
  );
}

/** Whether the background watcher runs for this session. */
export function watchOn(
  env: Record<string, string | undefined>,
  config: AskConfig,
): boolean {
  if (OFF.includes((env.ASK_WATCH ?? "").trim().toLowerCase())) return false;
  return config.watch !== false;
}

/** `text` trimmed and cut to `length` characters, or empty when it is not text. */
function cut(text: unknown, length: number): string {
  return typeof text === "string" ? text.trim().slice(0, length) : "";
}

/** The entry of `map` whose folder is the longest prefix of `cwd`. */
function longestPrefix(
  cwd: string,
  map: Record<string, string> | undefined,
): string | undefined {
  return Object.entries(map ?? {})
    .filter(([prefix]) => cwd === prefix || cwd.startsWith(`${prefix}/`))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1];
}

/** What `ask.ts ask` was given. */
export interface AskArguments {
  questions: AskedQuestion[];
  sessionId?: string;
  taskId?: string;
  title?: string;
}

/**
 * Parses `ask.ts ask` arguments. Each `--question` starts a question; the
 * `--option`, `--header` and `--multi` after it belong to it. An option is
 * `label` or `label=description`. Returns the reason when they do not parse.
 */
export function parseAskArguments(
  argv: readonly string[],
): AskArguments | { error: string } {
  const out: AskArguments = { questions: [] };
  const current = () => out.questions.at(-1);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === "--multi") {
      const q = current();
      if (!q) return { error: "--multi comes after a --question" };
      q.multiSelect = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) return { error: `${flag} needs a value` };
    i++;
    if (flag === "--question")
      out.questions.push({ options: [], question: value });
    else if (flag === "--option" || flag === "--header") {
      const q = current();
      if (!q) return { error: `${flag} comes after a --question` };
      if (flag === "--header") q.header = value;
      else {
        const at = value.indexOf("=");
        q.options.push(
          at > 0
            ? { description: value.slice(at + 1), label: value.slice(0, at) }
            : { label: value },
        );
      }
    } else if (flag === "--task") out.taskId = value;
    else if (flag === "--title") out.title = value;
    else if (flag === "--session-id") out.sessionId = value;
    else return { error: `unknown option ${flag}` };
  }
  if (out.questions.length > 4) return { error: "at most four questions" };
  return out;
}
