import { describe, expect, it } from "vitest";
import { DEMO_APPS } from "../../../../../packages/db/src/seed/demo-org";
import { demoAnswer, demoAnswers } from "./answers";

/**
 * The demo company only works end to end if every capability it was seeded
 * with can answer. A capability added to the seed without an answer here
 * would sit unconfirmed for ever and be the one thing in the demo that fails.
 */
describe("demo answers", () => {
  const all = DEMO_APPS.flatMap((app) =>
    app.capabilities.map((c) => ({ app: app.slug, name: c.name })),
  );

  it("covers every capability the demo company was seeded with", () => {
    const missing = all.filter(({ app, name }) => !demoAnswers(app, name));
    expect(missing).toEqual([]);
    expect(all.length).toBe(41);
  });

  it("gives the same answer to the same question", () => {
    const first = demoAnswer("ledger", "monthlyRevenue", { month: "2026-08" });
    expect(demoAnswer("ledger", "monthlyRevenue", { month: "2026-08" })).toEqual(first);
    expect(demoAnswer("ledger", "monthlyRevenue", { month: "2026-07" })).not.toEqual(
      first,
    );
  });

  it("answers from the seeded roster", () => {
    const team = demoAnswer("roster", "getTeam", { team: "platform" }) as {
      manager: string;
      members: Array<{ name: string }>;
    };
    expect(team.manager).toBe("Nina Castellanos");
    expect(team.members.map((m) => m.name)).toContain("Sam Adeyemi");
  });

  it("has nothing to say for an app or capability it does not know", () => {
    expect(demoAnswer("nope", "monthlyRevenue", {})).toBeUndefined();
    expect(demoAnswer("ledger", "nope", {})).toBeUndefined();
  });
});
