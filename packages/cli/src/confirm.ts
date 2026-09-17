import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { amber, dim, info } from "./ui.js";

/**
 * Asking for what an app needs, at the moment Cira notices it is not there.
 *
 * The alternative is a message saying something is missing and a prompt that
 * continues on Enter, which is the same as not asking: the answer to a
 * question nobody reads is always the default one. So the default here is to
 * supply the values, and going without them takes a word typed out in full.
 *
 * It is still only friction, never a refusal. What Cira knows is read from
 * source and a reading can be wrong - a variable may have a sane default
 * somewhere this did not look, or be supplied by something Cira cannot see. A
 * check that cannot be overruled is one people learn to route around.
 */

/** Typed in full, so it cannot be an Enter pressed on the way past. */
const SKIP = "skip";

export interface Missing {
  name: string;
  note: string;
}

export interface Resolution {
  /** Values given just now, to add to this deploy's environment. */
  added: Record<string, string>;
  /** Whether to go ahead with whatever is still missing. */
  proceed: boolean;
}

/**
 * Where the conversation happens.
 *
 * One question at a time, injected rather than assumed, so the exchange can be
 * tested without a terminal. Feeding a fake stream to readline does not work -
 * it wants a real one and simply never answers - and a pseudo-terminal
 * delivers a single line and stops, which tests the harness rather than this.
 */
export interface Prompt {
  ask(question: string, secret: boolean): Promise<string>;
  /** False in CI and in a pipe, where nobody is there to answer. */
  interactive: boolean;
}

export async function resolveMissing(
  root: string,
  missing: readonly Missing[],
  argv: readonly string[],
  envFile: string | null,
  io: Prompt = terminal(),
): Promise<Resolution> {
  // Nothing is waiting at a terminal in CI, and a deploy that blocks there
  // hangs a pipeline rather than protecting anybody.
  if (argv.includes("--yes") || argv.includes("-y") || !io.interactive) {
    return { added: {}, proceed: true };
  }

  info(dim("  Enter a value for each, or press Enter to leave it unset."));
  info("");

  const added: Record<string, string> = {};
  const column = Math.max(...missing.map((m) => m.name.length));

  for (const item of missing) {
    const value = (await io.ask(`  ${item.name.padEnd(column)}  `, true)).trim();
    if (value !== "") added[item.name] = value;
  }

  persist(root, envFile, added);

  const still = missing.filter((item) => added[item.name] === undefined);
  if (still.length === 0) {
    info("");
    return { added, proceed: true };
  }

  info("");
  info(
    `  ${amber("!")} ${still.length} still missing: ${still.map((s) => s.name).join(", ")}`,
  );
  info(dim(`  Type "${SKIP}" to deploy without ${still.length === 1 ? "it" : "them"}.`));

  const answer = await io.ask("  ", false);
  info("");

  return { added, proceed: answer.trim().toLowerCase() === SKIP };
}

/**
 * Keep what was typed, so the next deploy does not ask again.
 *
 * Only into a file that already exists. Creating one is a decision about
 * somebody's repository, and a `.env` appearing because a prompt was answered
 * is not a decision they made.
 */
function persist(
  root: string,
  envFile: string | null,
  added: Record<string, string>,
): Record<string, never> {
  const names = Object.keys(added);
  if (names.length === 0) return {};

  const path = join(root, envFile ?? ".env");
  if (!existsSync(path)) {
    info(
      dim(
        `  Used for this deploy only - there is no ${envFile ?? ".env"} to keep them in.`,
      ),
    );
    return {};
  }

  appendFileSync(
    path,
    `\n# Added by cira deploy\n${names.map((n) => `${n}=${added[n]}`).join("\n")}\n`,
  );
  info(dim(`  Saved to ${envFile ?? ".env"}.`));
  return {};
}

/** The real one: a readline over this terminal, opened per question. */
function terminal(): Prompt {
  return {
    interactive: process.stdin.isTTY === true,
    ask(question, secret) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      return (secret ? hidden(rl, question) : plain(rl, question)).finally(() =>
        rl.close(),
      );
    },
  };
}

function plain(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

/**
 * The same, without putting the value on screen.
 *
 * These are passwords and connection strings. Typing one into a terminal that
 * echoes it leaves it in the scrollback of whatever window happens to be open,
 * and in whatever is recording that window.
 *
 * Done through readline's own output hook rather than by replacing the stream
 * it writes to. Replacing the stream works right up until readline needs to
 * redraw the line for itself, and then the prompt hangs with nothing on screen
 * to say why - which is a far worse outcome than an echoed password.
 */
function hidden(rl: Interface, prompt: string): Promise<string> {
  const guts = rl as unknown as { _writeToOutput: (text: string) => void };
  const original = guts._writeToOutput.bind(rl);

  return new Promise((resolve) => {
    let masking = false;

    guts._writeToOutput = (text: string) => {
      // The prompt itself still has to appear; only what is typed after it is
      // withheld, and newlines pass so the cursor still moves on.
      if (!masking || text.includes("\n")) original(text);
    };

    rl.question(prompt, (answer) => {
      guts._writeToOutput = original;
      process.stdout.write("\n");
      resolve(answer);
    });

    masking = true;
  });
}
