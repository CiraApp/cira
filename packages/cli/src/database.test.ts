import { describe, expect, it } from "vitest";
import { chooseDatabase } from "./database.js";
import type { Prompt } from "./confirm.js";

const answering = (answer: string, interactive = true): Prompt & { asked: string[] } => {
  const asked: string[] = [];
  return {
    interactive,
    asked,
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(answer);
    },
  };
};

describe("chooseDatabase", () => {
  it("offers one when the code reads an address nobody set, yes by default", async () => {
    const io = answering("");
    const chosen = await chooseDatabase({
      missing: ["STRIPE_KEY", "POSTGRES_URL"],
      supplied: new Set(),
      argv: [],
      io,
    });
    expect(chosen).toEqual({ envName: "POSTGRES_URL" });
    expect(io.asked).toHaveLength(1);
  });

  it("takes no for an answer", async () => {
    const chosen = await chooseDatabase({
      missing: ["DATABASE_URL"],
      supplied: new Set(),
      argv: [],
      io: answering("n"),
    });
    expect(chosen).toEqual({ envName: null });
  });

  it("never makes one because nobody was there to say no", async () => {
    for (const [argv, interactive] of [
      [["--yes"], true],
      [[], false],
    ] as const) {
      const io = answering("y", interactive);
      const chosen = await chooseDatabase({
        missing: ["DATABASE_URL"],
        supplied: new Set(),
        argv,
        io,
      });
      expect(chosen).toEqual({ envName: null });
      expect(io.asked).toEqual([]);
    }
  });

  it("makes one outright with --database, as DATABASE_URL unless the code reads another", async () => {
    const io = answering("n", false);
    expect(
      await chooseDatabase({
        missing: [],
        supplied: new Set(),
        argv: ["--database"],
        io,
      }),
    ).toEqual({ envName: "DATABASE_URL" });
    expect(
      await chooseDatabase({
        missing: ["PG_URL"],
        supplied: new Set(),
        argv: ["--database"],
        io,
      }),
    ).toEqual({ envName: "PG_URL" });
  });

  it("refuses --database beside an address this deploy sets itself", async () => {
    const chosen = await chooseDatabase({
      missing: [],
      supplied: new Set(["DATABASE_URL"]),
      argv: ["--database"],
      io: answering(""),
    });
    expect(chosen).toMatchObject({
      error: expect.stringContaining("sets DATABASE_URL itself"),
    });
  });
});
