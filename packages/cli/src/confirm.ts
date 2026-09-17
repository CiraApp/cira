import { createInterface } from "node:readline";

/**
 * Asking before going ahead with something Cira has doubts about.
 *
 * Doubts, not refusals. What Cira knows about an app is read from its source,
 * and a reading can be wrong: a variable that looks required may have a sane
 * default somewhere this did not look, or be supplied by something Cira cannot
 * see. A check that cannot be overruled is one people learn to route around,
 * and then it stops being worth anything at all.
 *
 * So the answer is always available and the default is yes. What matters is
 * that it was said out loud first, so whoever continues knows what they are
 * continuing past.
 */
export async function confirmAnyway(argv: readonly string[]): Promise<boolean> {
  // Nothing is waiting at a terminal in CI, and a deploy that blocks there
  // hangs a pipeline rather than protecting anybody.
  if (argv.includes("--yes") || argv.includes("-y")) return true;
  if (!process.stdin.isTTY) return true;

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question("  Deploy anyway? [Y/n] ", resolve);
    });
    return !/^n/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
