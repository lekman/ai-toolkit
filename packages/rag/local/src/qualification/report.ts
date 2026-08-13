import type { CheckResult } from "../config";

/**
 * Renders qualification results into the markdown report artifact. Pure —
 * results in, markdown out.
 */
export class Report {
  /** True when every check passed. */
  static allPass(results: CheckResult[]): boolean {
    return results.every((result) => result.pass);
  }

  /** Render a titled qualification report with a per-check table. */
  static render(
    title: string,
    results: CheckResult[],
    timestamp: string,
  ): string {
    const rows = results
      .map(
        (result) =>
          `| ${result.pass ? "✅" : "❌"} | ${result.name} | ${result.detail}${
            result.pass ? "" : ` — remediation: ${result.remediation}`
          } |`,
      )
      .join("\n");
    const verdict = Report.allPass(results) ? "**PASS**" : "**FAIL**";
    return `# ${title}

- Run: ${timestamp}
- Result: ${verdict} (${results.filter((result) => result.pass).length}/${results.length} checks)

| Status | Check | Detail |
| --- | --- | --- |
${rows}
`;
  }
}
