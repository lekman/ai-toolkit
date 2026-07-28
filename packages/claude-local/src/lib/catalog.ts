/**
 * The models we offer, and the rules for which ones a machine can actually run.
 *
 * Sizes are the 4-bit MLX builds from the LM Studio catalog. `minRamGb` is the
 * total unified memory needed to hold the weights plus a usable context window,
 * given macOS wires only about 75% of RAM to the GPU.
 */

export type Role = "main" | "background";

export interface Model {
  /** Catalog key, as used by `lms get` and by Claude Code's --model flag. */
  key: string;
  label: string;
  sizeGb: number;
  minRamGb: number;
  role: Role;
  /** Selected by default in the setup checkbox list. */
  recommended: boolean;
  note: string;
}

export const MODELS: Model[] = [
  {
    key: "qwen/qwen3-coder-30b",
    label: "Qwen3-Coder 30B A3B",
    sizeGb: 17,
    minRamGb: 32,
    role: "main",
    recommended: true,
    note: "The one you work with. MoE, 3.3B active, ~30 tok/s. Trained for tool calls and file edits.",
  },
  {
    key: "google/gemma-4-e4b",
    label: "Gemma 4 E4B",
    sizeGb: 6,
    minRamGb: 16,
    role: "background",
    recommended: true,
    note: "Background model for titles and summaries. Too small for real work.",
  },
  {
    key: "google/gemma-4-26b-a4b",
    label: "Gemma 4 26B A4B",
    sizeGb: 16,
    minRamGb: 32,
    role: "main",
    recommended: false,
    note: "Stronger general reasoning, weaker tool-call discipline. Second opinion, poor driver.",
  },
  {
    key: "google/gemma-4-31b",
    label: "Gemma 4 31B",
    sizeGb: 19,
    minRamGb: 36,
    role: "main",
    recommended: false,
    note: "Dense, so better per token and noticeably slower.",
  },
];

export function findModel(key: string): Model | undefined {
  return MODELS.find((m) => m.key === key);
}

/** Is this model key present among the entries `lms ls` reported? */
export function isDownloaded(onDisk: string[], key: string): boolean {
  const short = key.split("/").pop() ?? key;
  return onDisk.some((entry) => {
    const lower = entry.toLowerCase();
    return (
      lower.includes(key.toLowerCase()) || lower.includes(short.toLowerCase())
    );
  });
}

/** Match a catalog entry against a line of `lms ls` output. */
export function matchModel(text: string): Model | undefined {
  const haystack = text.toLowerCase();
  return MODELS.find((m) => {
    const short = m.key.split("/").pop() ?? m.key;
    return (
      haystack.includes(m.key.toLowerCase()) ||
      haystack.includes(short.toLowerCase())
    );
  });
}

/**
 * Context window to load a model with. Claude Code's prompts are large, so
 * anything under 32k is unusable past a single file. We aim for 64k and only
 * back off on machines that cannot hold it alongside the weights.
 */
export function contextFor(model: Model, ramGb: number): number {
  const budgetGb = ramGb * 0.75 - model.sizeGb - 4;
  if (budgetGb >= 13) return 131072;
  if (budgetGb >= 7) return 65536;
  return 32768;
}
