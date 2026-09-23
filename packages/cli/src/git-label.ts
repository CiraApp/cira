import { execFileSync } from "node:child_process";

/**
 * What this folder was deployed from, in a line a colleague can recognise:
 * "3f9a1c2 Fix the delayed-shipment filter", and "+ changes" when the folder
 * held work not yet committed. Null outside a git repository, or when git is
 * not installed - it is a label, and a deploy never waits on it.
 */
export function gitLabel(cwd: string = process.cwd()): string | null {
  const git = (args: string[]): string =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
  try {
    const commit = git(["rev-parse", "--short", "HEAD"]);
    const subject = git(["log", "-1", "--format=%s"]);
    const dirty = git(["status", "--porcelain"]) !== "";
    return formatLabel(commit, subject, dirty);
  } catch {
    return null;
  }
}

/** One line of printable text, short enough for the server to take as it is. */
export function formatLabel(commit: string, subject: string, dirty: boolean): string {
  const clean = [...subject]
    .map((c) => (c < " " || c === "\u007f" ? " " : c))
    .join("")
    .replace(/ +/g, " ")
    .trim();
  const tail = dirty ? " + changes" : "";
  const room = 120 - commit.length - 1 - tail.length;
  const said = clean.length > room ? `${clean.slice(0, room - 3).trimEnd()}...` : clean;
  return `${commit} ${said}${tail}`.trim();
}
