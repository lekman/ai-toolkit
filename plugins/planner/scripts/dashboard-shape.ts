/**
 * dashboard-shape — the layout checks every planner script runs before it
 * acts on Dashboard.md.
 *
 * `## Focus` allows one unprefixed day, today, above the Tomorrow and Future
 * callouts. Every line after the first band header is inside a callout, so it
 * carries `"> "`. The scripts find today as the first unprefixed day heading,
 * so a second one is read as today, or hides the real one.
 *
 * On 12 Oct a session wrote whole days unprefixed below the Future callout.
 * The next morning roll-forward took that stray Tuesday for today and left
 * the real Tuesday in the Tomorrow band. A later write then put a new item
 * into the stray day. The checks here make that layout stop every script
 * instead.
 *
 * The same rules are in plugins/obsidian/scripts/dashboard-guard.sh, which
 * every skill runs before a hand edit. Change both together.
 */

const isDayHeading = (l: string) => /^#{2,3} \S/.test(l);
const isBandStart = (l: string) =>
  /^> \[!note\]- (Tomorrow|Future)\s*$/.test(l);

/** How many offending lines to quote before summarising the rest. */
const QUOTE = 3;

const quote = (lines: string[], at: number[]) =>
  at
    .slice(0, QUOTE)
    .map((i) => `line ${i + 1}: ${lines[i].slice(0, 60)}`)
    .join("; ") + (at.length > QUOTE ? `; and ${at.length - QUOTE} more` : "");

/**
 * Problems with the layout of `## Focus`, one sentence each. Empty when the
 * shape is sound, and when there is no `## Focus` (the caller reports that).
 */
export function shapeProblems(lines: string[]): string[] {
  const start = lines.findIndex((l) => /^## Focus\s*$/.test(l));
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }

  const problems: string[] = [];

  const days: number[] = [];
  for (let i = start + 1; i < end; i++) {
    if (isDayHeading(lines[i])) days.push(i);
  }
  if (days.length > 1)
    problems.push(
      `${days.length} unprefixed day headings in ## Focus, and only today may be unprefixed (${quote(lines, days)})`,
    );

  const band = lines.findIndex(
    (l, i) => i > start && i < end && isBandStart(l),
  );
  if (band >= 0) {
    const outside: number[] = [];
    for (let i = band + 1; i < end; i++) {
      if (lines[i].trim() !== "" && !lines[i].startsWith(">")) outside.push(i);
    }
    if (outside.length)
      problems.push(
        `${outside.length} lines below the Tomorrow and Future callouts have no "> " prefix, so they belong to no band (${quote(lines, outside)})`,
      );
  }

  return problems;
}

/** The message a script fails with when the shape is wrong. */
export function shapeFailure(problems: string[]): string {
  return [
    "Dashboard.md is not in the three-band shape, so nothing was changed.",
    ...problems.map((p) => `  - ${p}`),
    "Move the stray days and items into today or into the Tomorrow and Future callouts, then run this again. See plugins/obsidian/rules/dashboard-structure.md.",
  ].join("\n");
}
