/**
 * Turn an Azure subscription into a working Foundry configuration.
 *
 * Foundry has no setup wizard, so the README asks you to open the portal,
 * create deployments, copy their names, and write an env file by hand. Every
 * one of those steps is a place to mistype something that Foundry will not
 * report until the first prompt fails.
 *
 * The Azure CLI already knows all of it: which resources exist, which Claude
 * models the region offers, and which deployments are on the resource. This
 * asks it, creates only what is missing, and writes the env file from the
 * answers rather than from memory.
 *
 * Deployments only. Creating the resource itself means choosing a region, and
 * a region is a data-residency decision that should not sit behind a prompt.
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";

import { azLogin, UserError, which } from "./azure.js";
import {
  findEnvFile,
  HOME_ENV_FILE,
  readEnvFile,
  writeEnvFile,
} from "./config.js";

/** Only this account kind serves Anthropic models. `OpenAI` accounts do not. */
const FOUNDRY_KIND = "AIServices";

/** The model catalog groups Claude under one publisher format. */
const MODEL_FORMAT = "Anthropic";

/** Pay-per-token. A deployment that is never called costs nothing. */
const SKU = "GlobalStandard";

/**
 * The ARM API version used to create deployments.
 *
 * `az cognitiveservices account deployment create` cannot be used: Anthropic
 * deployments require a `modelProviderData` block, and neither the command nor
 * the management SDK behind it has a field for it, so every attempt fails with
 * `InvalidModelProviderData`. The REST call goes through `az rest`, which
 * reuses the same login.
 */
const DEPLOY_API_VERSION = "2025-10-01-preview";

/**
 * The industry values Foundry accepts, lowercase as the portal sends them.
 * Anything else is rejected when the marketplace agreement is signed.
 */
export const INDUSTRIES = [
  "technology",
  "finance",
  "healthcare",
  "education",
  "retail",
  "manufacturing",
  "government",
  "media",
  "other",
] as const;

/**
 * The three aliases a session reaches without being asked: `opus` and `sonnet`
 * are the defaults, and `haiku` runs background work such as session titles.
 * Fable is deliberately absent — it is only used if someone types it, and it
 * is still Preview in the catalog.
 */
const ALIASES = [
  { family: "opus", envVar: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
  { family: "sonnet", envVar: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
  { family: "haiku", envVar: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
] as const;

/** Where inference runs. Only matters if Azure is a compliance boundary. */
export type Hosting = "azure" | "anthropic";

export interface SetupOptions {
  /** Use this resource rather than discovering one. */
  resource?: string;
  /** Print the plan and change nothing. */
  dryRun: boolean;
  /** Skip the confirmation prompt. Required when stdin is not a terminal. */
  yes: boolean;
  /** Open a browser when the Azure session is expired. */
  login: boolean;
  /** Override the catalog's default SKU capacity, in thousands of tokens/min. */
  capacity?: number;
  /** Force a hosting variant instead of taking the catalog default. */
  hosting?: Hosting;
  /** Deploy the newest model even when an older one in the family is deployed. */
  upgrade: boolean;
  /** Anthropic requires these three before it will create a deployment. */
  organization?: string;
  industry?: string;
  country?: string;
}

interface Account {
  name: string;
  resourceGroup: string;
  location: string;
  kind: string;
}

interface CatalogModel {
  name: string;
  version: string;
  hostedOn?: string;
  isDefaultVersion: boolean;
  lifecycleStatus: string;
  capacity: number;
  /** Matches a quota entry from `az cognitiveservices usage list`. */
  usageName: string;
}

interface Deployment {
  name: string;
  model: string;
  version: string;
  format: string;
}

/** Remaining tokens per minute, in thousands, for one model in one region. */
interface Quota {
  used: number;
  limit: number;
}

/** One alias, and how it will be satisfied. */
interface Step {
  envVar: string;
  family: string;
  /** The deployment name to pin. Empty when nothing can serve this alias. */
  deployment: string;
  /** Set when the deployment has to be created first. */
  create?: { model: string; version: string; capacity: number };
  /** Set when nothing can serve this alias, and why. */
  blocked?: string;
}

/** The three fields Anthropic requires before a deployment can be created. */
interface ProviderData {
  organizationName: string;
  industry: string;
  countryCode: string;
}

/**
 * Run the Azure CLI and parse its JSON.
 *
 * `az` writes deprecation notices and quota warnings to stderr on success, so
 * only the exit code decides whether something went wrong.
 */
function az<T>(args: string[], timeoutMs = 60_000): T {
  const result = spawnSync("az", [...args, "--output", "json"], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new UserError(`Could not run az: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("WARNING"))
      .join("\n")
      .trim();
    throw new UserError(
      `az ${args.slice(0, 3).join(" ")} failed.\n${stderr || `Exit code ${result.status}.`}`,
    );
  }
  return JSON.parse(result.stdout || "null") as T;
}

/** Ask a yes/no question. Only reached when stdin is a terminal. */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Ask which of several resources to use. Only reached when stdin is a terminal. */
async function choose(accounts: Account[]): Promise<Account> {
  console.log(`\n  ${accounts.length} Foundry resources found:\n`);
  accounts.forEach((account, index) => {
    console.log(
      `    ${index + 1}) ${account.name} ${pc.dim(`(${account.location}, ${account.resourceGroup})`)}`,
    );
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\n  Which one? [1-${accounts.length}] `);
    const picked = accounts[Number(answer.trim()) - 1];
    if (!picked) throw new UserError("No resource chosen.");
    return picked;
  } finally {
    rl.close();
  }
}

/**
 * Split a catalog model name into a family and a comparable version.
 *
 * Names carry the version in the name itself — `claude-opus-4-8` and
 * `claude-opus-5` are the same family at different versions. Comparing the
 * parts as numbers rather than as text is what makes 5 outrank 4-8.
 */
function parseModelName(
  name: string,
): { family: string; version: number[] } | undefined {
  const match = /^claude-([a-z]+)-((?:\d+-)*\d+)$/.exec(name);
  if (!match) return undefined;
  return {
    family: match[1]!,
    version: match[2]!.split("-").map(Number),
  };
}

/** Newest first. Compares part by part, then treats a longer name as later. */
function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? -1) - (a[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Foundry-capable resources in the active subscription. */
function listAccounts(): Account[] {
  const accounts = az<Account[]>([
    "cognitiveservices",
    "account",
    "list",
    "--query",
    "[].{name:name,resourceGroup:resourceGroup,location:location,kind:kind}",
  ]);
  return (accounts ?? []).filter((account) => account.kind === FOUNDRY_KIND);
}

/**
 * Claude models the region offers, newest version of each name first.
 *
 * The service returns each model once per account kind, so the same name and
 * version can appear twice. Deduplicating on the pair keeps the later hosting
 * variants distinct while collapsing the repeats.
 */
function listModels(location: string): CatalogModel[] {
  const raw = az<
    {
      model: {
        name: string;
        version: string;
        format: string;
        isDefaultVersion: boolean;
        lifecycleStatus: string;
        capabilities?: { hostedOn?: string };
        skus?: {
          name: string;
          usageName?: string;
          capacity?: { default?: number };
        }[];
      };
    }[]
  >([
    "cognitiveservices",
    "model",
    "list",
    "--location",
    location,
    "--query",
    `[?model.format=='${MODEL_FORMAT}']`,
  ]);

  const seen = new Map<string, CatalogModel>();
  for (const entry of raw ?? []) {
    const sku = entry.model.skus?.find((candidate) => candidate.name === SKU);
    if (!sku) continue;
    const key = `${entry.model.name} ${entry.model.version}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      name: entry.model.name,
      version: entry.model.version,
      hostedOn: entry.model.capabilities?.hostedOn,
      isDefaultVersion: entry.model.isDefaultVersion,
      lifecycleStatus: entry.model.lifecycleStatus,
      capacity: sku.capacity?.default ?? 10,
      usageName: sku.usageName ?? "",
    });
  }
  return [...seen.values()];
}

/**
 * Per-model quota in the region.
 *
 * Quota for Anthropic models starts at zero and is granted per model on
 * request, so a brand-new subscription can see every model in the catalog and
 * deploy none of them. Checking first turns an opaque `InsufficientQuota`
 * failure halfway through into a plan that says which models are available.
 */
function listQuota(location: string): Map<string, Quota> {
  const usages = az<{ name: string; used: number; limit: number }[]>([
    "cognitiveservices",
    "usage",
    "list",
    "--location",
    location,
    "--query",
    "[].{name:name.value,used:currentValue,limit:limit}",
  ]);
  return new Map(
    (usages ?? []).map((usage) => [
      usage.name,
      { used: usage.used ?? 0, limit: usage.limit ?? 0 },
    ]),
  );
}

/** Anthropic deployments already on the resource. */
function listDeployments(account: Account): Deployment[] {
  const deployments = az<Deployment[]>([
    "cognitiveservices",
    "account",
    "deployment",
    "list",
    "--name",
    account.name,
    "--resource-group",
    account.resourceGroup,
    "--query",
    "[].{name:name,model:properties.model.name,version:properties.model.version,format:properties.model.format}",
  ]);
  return (deployments ?? []).filter((one) => one.format === MODEL_FORMAT);
}

/**
 * The models that could serve one alias, newest first, one entry per name.
 *
 * Within a name, `isDefaultVersion` is the service's own answer and is
 * preferred over guessing, because version strings are not consistent across
 * models — `claude-haiku-4-5` exists as both `20251001` and `2`, and the second
 * is the newer one.
 */
function candidatesFor(
  models: CatalogModel[],
  family: string,
  hosting?: Hosting,
): CatalogModel[] {
  const matching = models
    .filter((model) => model.lifecycleStatus === "GenerallyAvailable")
    .filter((model) => parseModelName(model.name)?.family === family)
    .filter((model) => !hosting || model.hostedOn === hosting)
    .sort((a, b) =>
      compareVersions(
        parseModelName(a.name)!.version,
        parseModelName(b.name)!.version,
      ),
    );

  const byName = new Map<string, CatalogModel>();
  for (const model of matching) {
    const chosen = byName.get(model.name);
    if (!chosen || (model.isDefaultVersion && !chosen.isDefaultVersion)) {
      byName.set(model.name, model);
    }
  }
  return [...byName.values()];
}

/** Work out what each alias needs, without changing anything. */
function plan(
  models: CatalogModel[],
  deployments: Deployment[],
  quota: Map<string, Quota>,
  options: SetupOptions,
): Step[] {
  return ALIASES.map(({ family, envVar }): Step => {
    // An existing deployment in the family is reused rather than superseded:
    // creating a second one spends quota to replace something that works.
    const existing = deployments
      .filter((one) => parseModelName(one.model)?.family === family)
      .sort((a, b) =>
        compareVersions(
          parseModelName(a.model)!.version,
          parseModelName(b.model)!.version,
        ),
      )[0];

    const candidates = candidatesFor(models, family, options.hosting);
    // --upgrade only means something when the catalog actually offers a newer
    // model than the one deployed; otherwise the existing deployment stands.
    const supersedable =
      options.upgrade &&
      candidates.length > 0 &&
      candidates[0]!.name !== existing?.model;
    if (existing && !supersedable) {
      return { envVar, family, deployment: existing.name };
    }

    // Quota is granted per model, so the newest model is not always the one
    // that can be deployed. Falling back to the next-newest with headroom beats
    // failing when a usable model is one step down the list.
    const target = candidates.find((model) => {
      const wanted = options.capacity ?? model.capacity;
      const have = quota.get(model.usageName);
      return have ? have.limit - have.used >= wanted : false;
    });

    if (!target) {
      const newest = candidates[0];
      const hostingNote = options.hosting ? ` hosted on ${options.hosting}` : "";
      return {
        envVar,
        family,
        deployment: "",
        blocked: newest
          ? `no quota for ${family}${hostingNote} in this region ` +
            `(${newest.name}: ${quota.get(newest.usageName)?.limit ?? 0}k TPM granted)`
          : `no ${family} model${hostingNote} in this region`,
      };
    }

    return {
      envVar,
      family,
      // The deployment name is what gets pinned, so naming it after the model
      // keeps the env file readable and makes a rerun idempotent.
      deployment: target.name,
      create: {
        model: target.name,
        version: target.version,
        capacity: options.capacity ?? target.capacity,
      },
    };
  });
}

/** Wait until a just-created deployment stops being provisional. */
async function waitForDeployment(
  subscription: string,
  account: Account,
  name: string,
): Promise<void> {
  const url = deploymentUrl(subscription, account, name);
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = az<{ properties?: { provisioningState?: string } }>([
      "rest",
      "--method",
      "get",
      "--url",
      url,
    ]).properties?.provisioningState;
    if (state === "Succeeded") return;
    if (state === "Failed" || state === "Canceled") {
      throw new UserError(`Deployment ${name} ended in state ${state}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new UserError(
    `Deployment ${name} is still provisioning after five minutes.\n` +
      `It may still succeed — check the portal, then rerun --setup.`,
  );
}

function deploymentUrl(
  subscription: string,
  account: Account,
  name: string,
): string {
  return (
    `https://management.azure.com/subscriptions/${subscription}` +
    `/resourceGroups/${account.resourceGroup}` +
    `/providers/Microsoft.CognitiveServices/accounts/${account.name}` +
    `/deployments/${name}?api-version=${DEPLOY_API_VERSION}`
  );
}

/**
 * Create one deployment through the management API.
 *
 * `modelProviderData` is what signs the Anthropic marketplace agreement behind
 * the deployment. It is required, it is not optional per-model, and no `az
 * cognitiveservices` flag sets it — which is why this is a REST call.
 */
async function createDeployment(
  subscription: string,
  account: Account,
  step: Step,
  provider: ProviderData,
): Promise<void> {
  const create = step.create!;
  process.stdout.write(
    `  creating ${step.deployment} ${pc.dim(`(${create.model} v${create.version})`)} … `,
  );
  az(
    [
      "rest",
      "--method",
      "put",
      "--url",
      deploymentUrl(subscription, account, step.deployment),
      "--body",
      JSON.stringify({
        sku: { name: SKU, capacity: create.capacity },
        properties: {
          model: {
            format: MODEL_FORMAT,
            name: create.model,
            version: create.version,
          },
          modelProviderData: provider,
        },
      }),
    ],
    120_000,
  );
  await waitForDeployment(subscription, account, step.deployment);
  console.log(pc.green("done"));
}

/**
 * Collect the three fields Anthropic requires, asking only when they were not
 * given as flags and only when something is actually going to be created.
 */
async function resolveProviderData(
  options: SetupOptions,
): Promise<ProviderData> {
  // Flag values are already validated by the parser; only typed answers below
  // still need checking.
  const industry = options.industry;
  const country = options.country;

  if (options.organization && industry && country) {
    return {
      organizationName: options.organization,
      industry,
      countryCode: country,
    };
  }
  if (!process.stdin.isTTY) {
    throw new UserError(
      `Anthropic requires an organization, industry, and country before it will\n` +
        `create a deployment, and the Foundry portal does not ask for all three.\n` +
        `Pass them: --org <name> --industry <${INDUSTRIES.join("|")}> --country <XX>`,
    );
  }

  console.log(
    `\n  ${pc.bold("Anthropic requires this before creating a deployment")}\n` +
      pc.dim(
        `  It signs the marketplace agreement. Stored on the deployment in Azure,\n` +
          `  not in your env file.\n`,
      ),
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const organizationName =
      options.organization || (await rl.question("  Organization name: ")).trim();
    const answeredIndustry =
      industry ||
      (await rl.question(`  Industry [${INDUSTRIES.join(", ")}]: `))
        .trim()
        .toLowerCase();
    const answeredCountry =
      country ||
      (await rl.question("  Country code (2-letter ISO): ")).trim().toUpperCase();

    if (!organizationName) throw new UserError("An organization name is required.");
    if (!INDUSTRIES.includes(answeredIndustry as (typeof INDUSTRIES)[number])) {
      throw new UserError(`Industry must be one of: ${INDUSTRIES.join(", ")}.`);
    }
    if (!/^[A-Z]{2}$/.test(answeredCountry)) {
      throw new UserError("Country must be a two-letter ISO code, such as SE.");
    }
    return {
      organizationName,
      industry: answeredIndustry,
      countryCode: answeredCountry,
    };
  } finally {
    rl.close();
  }
}

/**
 * Subscription types that cannot buy Azure Marketplace SaaS offers.
 *
 * Claude on Foundry is one, so these subscriptions sit at zero quota in every
 * region however many times you ask for more. Worth naming, because the symptom
 * — models listed, quota zero — looks exactly like a quota request that has not
 * been approved yet.
 */
const UNSUPPORTED_QUOTA_IDS = [
  { prefix: "MSDN_", label: "Visual Studio / MSDN" },
  { prefix: "MPN_", label: "Microsoft Partner Network" },
  { prefix: "FreeTrial_", label: "free trial" },
  { prefix: "AzureForStudent", label: "Azure for Students" },
  { prefix: "SponsoredMS", label: "sponsored" },
];

/** The subscription's offer type, or undefined if it cannot be read. */
function quotaIdOf(subscriptionId: string): string | undefined {
  try {
    return az<{ subscriptionPolicies?: { quotaId?: string } }>([
      "rest",
      "--method",
      "get",
      "--url",
      `https://management.azure.com/subscriptions/${subscriptionId}?api-version=2022-12-01`,
    ]).subscriptionPolicies?.quotaId;
  } catch {
    // Only used to explain a failure better. Never worth failing over.
    return undefined;
  }
}

/** Make sure `az` can answer management calls, logging in if allowed to. */
async function ensureSignedIn(
  login: boolean,
): Promise<{ id: string; name: string }> {
  if (!which("az")) {
    throw new UserError(
      "The Azure CLI is required for --setup, and `az` is not on your PATH.\n" +
        "Install it from https://learn.microsoft.com/cli/azure/install-azure-cli.",
    );
  }
  const show = spawnSync("az", ["account", "show", "--output", "json"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (show.status !== 0) {
    if (!login) {
      throw new UserError("Not signed in to Azure.\nRun: az login");
    }
    console.error(
      pc.dim("[claude-foundry] not signed in to Azure — opening browser."),
    );
    if (!(await azLogin())) {
      throw new UserError("Azure login failed. Log in manually, then rerun.");
    }
  }
  return az<{ name: string; id: string }>(["account", "show"]);
}

/** Resolve which resource to work on, asking only when the answer is ambiguous. */
async function resolveAccount(options: SetupOptions): Promise<Account> {
  const accounts = listAccounts();
  if (accounts.length === 0) {
    throw new UserError(
      `No Foundry resource found in this subscription.\n\n` +
        `  Setup creates deployments, not resources — a resource fixes a region,\n` +
        `  and that is a data-residency decision worth making deliberately.\n\n` +
        `  Create one at ${pc.cyan("https://ai.azure.com/")} and rerun, or switch\n` +
        `  subscription with ${pc.cyan("az account set --subscription <name>")}.`,
    );
  }
  if (options.resource) {
    const match = accounts.find((one) => one.name === options.resource);
    if (!match) {
      throw new UserError(
        `No Foundry resource named ${options.resource} in this subscription.\n` +
          `Found: ${accounts.map((one) => one.name).join(", ")}`,
      );
    }
    return match;
  }
  if (accounts.length === 1) return accounts[0]!;
  if (!process.stdin.isTTY) {
    throw new UserError(
      `Several Foundry resources found — pass --resource <name>.\n` +
        `Found: ${accounts.map((one) => one.name).join(", ")}`,
    );
  }
  return choose(accounts);
}

/** The env file setup owns. Anything else already in the file is preserved. */
function envForAccount(account: Account, steps: Step[]): Record<string, string> {
  const vars: Record<string, string> = {
    CLAUDE_CODE_USE_FOUNDRY: "1",
    ANTHROPIC_FOUNDRY_RESOURCE: account.name,
  };
  for (const step of steps) {
    if (step.deployment) vars[step.envVar] = step.deployment;
  }
  return vars;
}

const HEADER = [
  "# Read by @lekman/claude-foundry and handed to one child process.",
  "# Not exported to your shell, and not read by bare `claude`.",
  "#",
  "# Written by `claude-foundry --setup` from what the Azure CLI reported.",
  "# Rerun it after deploying a newer model; it rewrites only the variables",
  "# below and leaves anything else in this file alone.",
];

/**
 * Discover, create what is missing, and write the env file.
 *
 * Nothing is created before the plan is shown and agreed to. The plan is the
 * whole point — it is the difference between this and clicking through the
 * portal hoping the names match what you type later.
 */
export async function runSetup(options: SetupOptions): Promise<void> {
  console.log(pc.bold("\nclaude-foundry --setup\n"));

  const subscription = await ensureSignedIn(options.login);
  console.log(
    `  subscription  ${subscription.name} ${pc.dim(`(${subscription.id})`)}`,
  );

  const account = await resolveAccount(options);
  console.log(
    `  resource      ${account.name} ${pc.dim(`(${account.location}, ${account.resourceGroup})`)}`,
  );

  const models = listModels(account.location);
  if (models.length === 0) {
    throw new UserError(
      `No Claude models are offered in ${account.location}.\n` +
        `The resource's region decides this. Create a resource in a region that\n` +
        `carries them, then rerun with --resource <name>.`,
    );
  }

  const deployments = listDeployments(account);
  const quota = listQuota(account.location);
  const steps = plan(models, deployments, quota, options);

  console.log(`\n  ${pc.bold("Plan")}\n`);
  for (const step of steps) {
    const label = step.envVar.padEnd(30);
    if (step.blocked) {
      console.log(`  ${label} ${pc.yellow("blocked")} ${pc.dim(step.blocked)}`);
    } else if (step.create) {
      console.log(
        `  ${label} ${pc.green("create")}  ${step.deployment} ` +
          pc.dim(
            `v${step.create.version}, ${SKU}, ${step.create.capacity}k TPM`,
          ),
      );
    } else {
      console.log(`  ${label} ${pc.dim("reuse")}   ${step.deployment}`);
    }
  }

  const blocked = steps.filter((step) => step.blocked);
  if (blocked.length === steps.length) {
    const quotaId = quotaIdOf(subscription.id);
    const unsupported = UNSUPPORTED_QUOTA_IDS.find((entry) =>
      quotaId?.startsWith(entry.prefix),
    );
    throw new UserError(
      `No Claude model in ${account.location} has quota in this subscription.\n\n` +
        `  Quota for Anthropic models starts at zero and is granted per model, so\n` +
        `  the models appear in the catalog whether or not you can deploy them.\n` +
        `  That is why the portal lets you try and then fails.\n\n` +
        (unsupported
          ? `  ${pc.yellow("This is a " + unsupported.label + " subscription")} (${quotaId}). Claude on Foundry is\n` +
            `  an Azure Marketplace offer, and these subscriptions cannot buy one — so\n` +
            `  the quota stays at zero in every region, however often you ask. Moving\n` +
            `  region will not help. Use a pay-as-you-go subscription instead.\n\n`
          : `  Ask for an initial allocation through an Azure support ticket, not the\n` +
            `  quota form — that form raises an allocation that already exists.\n\n`) +
        `  Nothing was created.`,
    );
  }
  if (blocked.length) {
    console.log(
      pc.dim(
        `\n  Blocked aliases are left unpinned. Claude Code falls back to its\n` +
          `  built-in default for them, which Foundry does not verify.`,
      ),
    );
  }

  const envFile = HOME_ENV_FILE;
  const toCreate = steps.filter((step) => step.create);
  console.log(`\n  ${pc.bold("Writes")}\n`);
  console.log(`  ${envFile}`);
  if (toCreate.length) {
    console.log(
      pc.dim(
        `  ${toCreate.length} deployment${toCreate.length === 1 ? "" : "s"} on ${account.name}. ` +
          `${SKU} bills per token, so an unused deployment costs nothing.`,
      ),
    );
  }

  const repoFile = findEnvFile();
  if (repoFile && repoFile.path !== envFile) {
    console.log(
      `\n  ${pc.yellow("note")} ${repoFile.path} exists and takes precedence over the file\n` +
        `       written here. Delete it, or edit it instead.`,
    );
  }

  if (options.dryRun) {
    console.log(pc.dim("\n  --dry-run: nothing was changed.\n"));
    return;
  }

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      throw new UserError("Not a terminal — rerun with --yes or --dry-run.");
    }
    console.log();
    if (!(await confirm("  Proceed?"))) {
      console.log(pc.dim("  Cancelled.\n"));
      return;
    }
  }

  if (toCreate.length) {
    const provider = await resolveProviderData(options);
    console.log();
    for (const step of toCreate) {
      await createDeployment(subscription.id, account, step, provider);
    }
  }

  // The file is merged, not replaced: a hand-written API key or a caching flag
  // is nothing setup knows about, and dropping it would be a silent regression.
  const existing = readEnvFile(envFile);
  const merged = { ...existing, ...envForAccount(account, steps) };
  // A resource name and a base URL are alternatives, and the launcher refuses
  // to start with both. Setup sets the resource, so a stale URL has to go.
  delete merged.ANTHROPIC_FOUNDRY_BASE_URL;
  writeEnvFile(envFile, merged, HEADER);

  console.log(`\n  ${pc.green("Wrote")} ${envFile}\n`);
  console.log(
    pc.dim(
      `  Check it with ${pc.cyan("claude-foundry --status")}, ` +
        `then run ${pc.cyan("claude-foundry")}.\n`,
    ),
  );
}
