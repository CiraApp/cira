import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveMissing, type Prompt } from "./confirm.js";

/**
 * The exchange when an app needs something it has not been given.
 *
 * The whole point is that going without takes a deliberate act, so what is
 * asserted here is mostly what does *not* count as one.
 */
let root: string;

function repo(files: Record<string, string> = {}): string {
  root = mkdtempSync(join(tmpdir(), "cira-confirm-"));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, name), body);
  }
  return root;
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

/** Answers the questions in order, and records what was asked in secret. */
function typing(lines: string[]): Prompt & { secrets: string[] } {
  const queue = [...lines];
  const secrets: string[] = [];

  return {
    interactive: true,
    secrets,
    ask(question, secret) {
      if (secret) secrets.push(question.trim());
      return Promise.resolve(queue.shift() ?? "");
    },
  };
}

const MISSING = [
  { name: "REDIS_URL", note: "defaults to localhost, in config.py" },
  { name: "SMTP_HOST", note: "defaults to localhost, in config.py" },
];

describe("resolveMissing", () => {
  it("takes what is typed and carries on", async () => {
    const result = await resolveMissing(
      repo({ ".env": "FOO=bar\n" }),
      MISSING,
      [],
      ".env",
      typing(["rediss://given", "smtp.example.test"]),
    );

    expect(result.added).toEqual({
      REDIS_URL: "rediss://given",
      SMTP_HOST: "smtp.example.test",
    });
    // Nothing is missing any more, so nothing had to be agreed to.
    expect(result.proceed).toBe(true);
  });

  it("keeps what was typed, so the next deploy does not ask again", async () => {
    const dir = repo({ ".env": "FOO=bar\n" });
    await resolveMissing(
      dir,
      MISSING,
      [],
      ".env",
      typing(["rediss://given", "smtp.example.test"]),
    );

    const written = readFileSync(join(dir, ".env"), "utf8");
    expect(written).toContain("FOO=bar");
    expect(written).toContain("REDIS_URL=rediss://given");
    expect(written).toContain("SMTP_HOST=smtp.example.test");
  });

  it("will not create an env file that was not there", async () => {
    // Somebody's repository gaining a file because they answered a prompt is
    // not a decision they made.
    const dir = repo();
    const result = await resolveMissing(dir, MISSING, [], null, typing(["x", "y"]));

    expect(result.added).toEqual({ REDIS_URL: "x", SMTP_HOST: "y" });
    expect(() => readFileSync(join(dir, ".env"), "utf8")).toThrow();
  });

  /** The point of the whole exchange. */
  it("does not treat pressing Enter as agreement", async () => {
    const result = await resolveMissing(
      repo({ ".env": "" }),
      MISSING,
      [],
      ".env",
      typing(["", "", ""]),
    );

    expect(result.added).toEqual({});
    expect(result.proceed).toBe(false);
  });

  it("does not treat yes as agreement either", async () => {
    // "y" is what a hand types on the way past a prompt it did not read.
    for (const answer of ["y", "yes", "Y", "ok", " "]) {
      const result = await resolveMissing(
        repo({ ".env": "" }),
        MISSING,
        [],
        ".env",
        typing(["", "", answer]),
      );
      expect(result.proceed, answer).toBe(false);
    }
  });

  it("goes ahead when the word is typed out", async () => {
    const result = await resolveMissing(
      repo({ ".env": "" }),
      MISSING,
      [],
      ".env",
      typing(["", "", "skip"]),
    );

    expect(result.proceed).toBe(true);
  });

  it("asks only about what is still missing", async () => {
    const result = await resolveMissing(
      repo({ ".env": "" }),
      MISSING,
      [],
      ".env",
      // One supplied, one left - so the last line answers the skip prompt.
      typing(["rediss://given", "", "skip"]),
    );

    expect(result.added).toEqual({ REDIS_URL: "rediss://given" });
    expect(result.proceed).toBe(true);
  });

  it("never stops to ask where nobody is waiting", async () => {
    // A pipeline blocked on a prompt is worse than a deploy that went ahead.
    for (const io of [{ ...typing([]), interactive: false }, typing([])] as const) {
      const argv = io.interactive ? ["--yes"] : [];
      const result = await resolveMissing(repo(), MISSING, argv, null, io);
      expect(result.proceed).toBe(true);
      expect(result.added).toEqual({});
    }
  });

  it("asks for values without putting them on screen", async () => {
    // Connection strings and passwords. A terminal that echoes one leaves it
    // in the scrollback of whatever window is open, and in whatever is
    // recording that window.
    const io = typing(["rediss://given", "smtp.example.test"]);
    await resolveMissing(repo({ ".env": "" }), MISSING, [], ".env", io);

    expect(io.secrets).toEqual(["REDIS_URL", "SMTP_HOST"]);
  });
});
