import * as p from "@clack/prompts";

/** Treat Ctrl-C at a prompt as "change nothing", not as an error. */
export function cancelled(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel("Nothing was changed.");
    process.exit(0);
  }
}
