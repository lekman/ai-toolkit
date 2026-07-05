import { expect, test } from "bun:test";
import { findSharedModeViolation } from "./deny-local-writes.mjs";

const REPO = "/repo";

test("denies a write to a tracked file in the checkout", () => {
  expect(findSharedModeViolation("Write", "/repo/src/index.ts", REPO)).toBe(
    "src/index.ts",
  );
});
test("denies an edit to a file at the repo root", () => {
  expect(findSharedModeViolation("Edit", "/repo/README.md", REPO)).toBe(
    "README.md",
  );
});
test("guards NotebookEdit like the write tools", () => {
  expect(findSharedModeViolation("NotebookEdit", "/repo/nb.ipynb", REPO)).toBe(
    "nb.ipynb",
  );
});
test("allows edits inside .claude/worktrees", () => {
  expect(
    findSharedModeViolation("Edit", "/repo/.claude/worktrees/t/src/a.ts", REPO),
  ).toBeNull();
});
test("allows writes under a .workflow folder", () => {
  expect(
    findSharedModeViolation("Write", "/repo/pkg/.workflow/out.txt", REPO),
  ).toBeNull();
});
test("allows writes outside the repository", () => {
  expect(
    findSharedModeViolation("Write", "/outside/scratch.txt", REPO),
  ).toBeNull();
});
test("does not treat a sibling dir sharing the repo prefix as inside", () => {
  expect(findSharedModeViolation("Write", "/repo-other/x.ts", REPO)).toBeNull();
});
test("does not guard non-write tools", () => {
  expect(findSharedModeViolation("Bash", "/repo/src/index.ts", REPO)).toBeNull();
});
test("allows an empty path (nothing to guard)", () => {
  expect(findSharedModeViolation("Write", "", REPO)).toBeNull();
});
