import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { canAccessApp, newId, visibleApps } from "@cira/core";
import type { App, AppAccess, Membership, Principal } from "@cira/core";
import {
  appAccess,
  apps,
  deployments,
  invites,
  memberships,
  spaces,
  teamMembers,
  teams,
  users,
} from "../schema.js";
import type { TestDatabase } from "../testing.js";
import { freshDatabase, hasDatabase } from "./harness.js";

/**
 * The two journeys the product is judged on, run against a real database.
 *
 * These exist because the expensive failures here are not crashes, they are
 * quiet wrong answers: someone seeing an app they were never given. A test
 * that asserts what a person can see is worth more than one that asserts a
 * function returned.
 */
describe.skipIf(!hasDatabase)("product journeys", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
  }, 60_000);

  afterAll(async () => {
    await db?.end();
  });

  async function loadContext(spaceId: string) {
    const memberRows = (await db
      .select()
      .from(memberships)
      .where(eq(memberships.spaceId, spaceId))) as Membership[];
    const appRows = (await db
      .select()
      .from(apps)
      .where(eq(apps.spaceId, spaceId))) as App[];
    const grantRows = (await db.select().from(appAccess)) as AppAccess[];
    const teamRows = await db.select().from(teamMembers);
    return { memberRows, appRows, grantRows, teamRows };
  }

  /** The acting person, assembled from the rows the database actually holds. */
  function who(
    userId: string,
    memberRows: Membership[],
    teamRows: Array<{ teamId: string; userId: string }>,
  ): Principal {
    return {
      userId,
      memberships: memberRows,
      teamIds: teamRows.filter((t) => t.userId === userId).map((t) => t.teamId),
    };
  }

  describe("a company sets itself up and shares one app", () => {
    const acme = newId("space");
    const founder = newId("user");
    const employee = newId("user");
    const outsider = newId("user");
    const shared = newId("app");
    const private_ = newId("app");

    beforeAll(async () => {
      await db.insert(users).values([
        { id: founder, externalId: "ext_founder", name: "Aum", email: "aum@acme.com" },
        {
          id: employee,
          externalId: "ext_employee",
          name: "Dana",
          email: "dana@acme.com",
        },
        { id: outsider, externalId: "ext_outsider", name: "Eve", email: "eve@other.com" },
      ]);
      await db
        .insert(spaces)
        .values({ id: acme, name: "Acme", slug: "acme", domain: "acme.com" });
      await db.insert(memberships).values([
        { id: newId("membership"), userId: founder, spaceId: acme, role: "owner" },
        { id: newId("membership"), userId: employee, spaceId: acme, role: "member" },
      ]);
      await db.insert(apps).values([
        {
          id: shared,
          spaceId: acme,
          name: "Revenue",
          slug: "revenue",
          ownerUserId: founder,
          status: "live",
        },
        {
          id: private_,
          spaceId: acme,
          name: "Payroll",
          slug: "payroll",
          ownerUserId: founder,
          status: "live",
        },
      ]);
      await db.insert(appAccess).values({
        id: newId("access"),
        appId: shared,
        type: "user",
        targetId: employee,
      });
    });

    it("shows the employee only what they were given", async () => {
      const { memberRows, appRows, grantRows, teamRows } = await loadContext(acme);
      const seen = visibleApps({
        principal: who(employee, memberRows, teamRows),
        apps: appRows,
        access: grantRows,
      });
      expect(seen.map((a) => a.slug)).toEqual(["revenue"]);
    });

    it("shows the founder everything, without needing a grant", async () => {
      const { memberRows, appRows, grantRows, teamRows } = await loadContext(acme);
      const seen = visibleApps({
        principal: who(founder, memberRows, teamRows),
        apps: appRows,
        access: grantRows,
      });
      expect(seen.map((a) => a.slug).sort()).toEqual(["payroll", "revenue"]);
    });

    it("shows an outsider nothing at all, grant or no grant", async () => {
      const { memberRows, appRows, grantRows, teamRows } = await loadContext(acme);
      const seen = visibleApps({
        principal: who(outsider, memberRows, teamRows),
        apps: appRows,
        access: grantRows,
      });
      expect(seen).toEqual([]);
    });

    it("revoking access takes the app away again", async () => {
      await db
        .delete(appAccess)
        .where(and(eq(appAccess.appId, shared), eq(appAccess.targetId, employee)));

      const { memberRows, appRows, grantRows, teamRows } = await loadContext(acme);
      expect(
        visibleApps({
          principal: who(employee, memberRows, teamRows),
          apps: appRows,
          access: grantRows,
        }),
      ).toEqual([]);

      await db.insert(appAccess).values({
        id: newId("access"),
        appId: shared,
        type: "user",
        targetId: employee,
      });
    });

    it("a space-wide grant reaches members and still stops at the door", async () => {
      await db.insert(appAccess).values({
        id: newId("access"),
        appId: private_,
        type: "space",
        targetId: acme,
      });

      const { memberRows, appRows, grantRows, teamRows } = await loadContext(acme);
      const payroll = appRows.find((a) => a.slug === "payroll") as App;

      expect(
        canAccessApp({
          principal: who(employee, memberRows, teamRows),
          app: payroll,
          access: grantRows,
        }),
      ).toBe(true);
      // Eve is in no space, so a space-wide grant is not hers to use.
      expect(
        canAccessApp({
          principal: who(outsider, memberRows, teamRows),
          app: payroll,
          access: grantRows,
        }),
      ).toBe(false);
    });
  });

  describe("the database refuses what the rules refuse", () => {
    it("will not let one person join the same space twice", async () => {
      const [row] = await db.select().from(memberships).limit(1);
      await expect(
        db.insert(memberships).values({
          id: newId("membership"),
          userId: (row as Membership).userId,
          spaceId: (row as Membership).spaceId,
          role: "admin",
        }),
      ).rejects.toThrow();
    });

    it("will not let two apps in one space share a slug", async () => {
      const [existing] = await db.select().from(apps).limit(1);
      const app = existing as App;
      await expect(
        db.insert(apps).values({
          id: newId("app"),
          spaceId: app.spaceId,
          name: "Impostor",
          slug: app.slug,
          ownerUserId: app.ownerUserId,
        }),
      ).rejects.toThrow();
    });

    it("will not duplicate a grant", async () => {
      const [grant] = await db.select().from(appAccess).limit(1);
      const g = grant as AppAccess;
      await expect(
        db.insert(appAccess).values({
          id: newId("access"),
          appId: g.appId,
          type: g.type,
          targetId: g.targetId,
        }),
      ).rejects.toThrow();
    });

    it("will not orphan an app by deleting whoever owns it", async () => {
      const [app] = await db.select().from(apps).limit(1);
      await expect(
        db.delete(users).where(eq(users.id, (app as App).ownerUserId)),
      ).rejects.toThrow();
    });

    it("removes a space cleanly, leaving nothing of it behind", async () => {
      const doomed = newId("space");
      const owner = newId("user");
      await db.insert(users).values({
        id: owner,
        externalId: "ext_doomed",
        name: "Temp",
        email: "temp@doomed.com",
      });
      await db.insert(spaces).values({ id: doomed, name: "Doomed", slug: "doomed" });
      await db.insert(memberships).values({
        id: newId("membership"),
        userId: owner,
        spaceId: doomed,
        role: "owner",
      });
      const appId = newId("app");
      await db.insert(apps).values({
        id: appId,
        spaceId: doomed,
        name: "Thing",
        slug: "thing",
        ownerUserId: owner,
      });
      await db.insert(appAccess).values({
        id: newId("access"),
        appId,
        type: "space",
        targetId: doomed,
      });
      await db.insert(deployments).values({
        id: newId("deployment"),
        appId,
        provider: "vercel",
        providerDeploymentId: "dpl_x",
        status: "live",
        url: "https://x.example",
      });

      await db.delete(spaces).where(eq(spaces.id, doomed));

      expect(await db.select().from(apps).where(eq(apps.spaceId, doomed))).toEqual([]);
      expect(await db.select().from(appAccess).where(eq(appAccess.appId, appId))).toEqual(
        [],
      );
      expect(
        await db.select().from(deployments).where(eq(deployments.appId, appId)),
      ).toEqual([]);
    });

    it("will not issue two invites with the same token", async () => {
      const [space] = await db.select().from(spaces).limit(1);
      const [user] = await db.select().from(users).limit(1);
      const token = "t".repeat(64);
      const base = {
        spaceId: (space as { id: string }).id,
        email: "someone@acme.com",
        token,
        invitedByUserId: (user as { id: string }).id,
        expiresAt: new Date(Date.now() + 86_400_000),
      };
      await db.insert(invites).values({ id: newId("invite"), ...base });
      await expect(
        db
          .insert(invites)
          .values({ id: newId("invite"), ...base, email: "other@acme.com" }),
      ).rejects.toThrow();
    });
  });
  describe("a team is given an app, and the roster changes under it", () => {
    const halcyon = newId("space");
    const head = newId("user");
    const engineer = newId("user");
    const newHire = newId("user");
    const salesperson = newId("user");
    const engineering = newId("team");
    const runbook = newId("app");

    beforeAll(async () => {
      await db.insert(users).values([
        { id: head, externalId: "ext_head", name: "Maya", email: "maya@halcyon.dev" },
        {
          id: engineer,
          externalId: "ext_eng",
          name: "Tobias",
          email: "tobias@halcyon.dev",
        },
        {
          id: newHire,
          externalId: "ext_hire",
          name: "Priya",
          email: "priya@halcyon.dev",
        },
        {
          id: salesperson,
          externalId: "ext_sales",
          name: "Jonah",
          email: "jonah@halcyon.dev",
        },
      ]);
      await db
        .insert(spaces)
        .values({ id: halcyon, name: "Halcyon", slug: "halcyon", domain: "halcyon.dev" });
      await db.insert(memberships).values(
        [head, engineer, newHire, salesperson].map((userId) => ({
          id: newId("membership"),
          userId,
          spaceId: halcyon,
          // Plain members throughout: an admin can open everything anyway, which
          // would prove nothing about the team rule.
          role: "member" as const,
        })),
      );
      await db.insert(teams).values({
        id: engineering,
        spaceId: halcyon,
        name: "Engineering",
        slug: "engineering",
      });
      await db.insert(teamMembers).values(
        [head, engineer].map((userId) => ({
          id: newId("teamMember"),
          teamId: engineering,
          userId,
        })),
      );
      await db.insert(apps).values({
        id: runbook,
        spaceId: halcyon,
        name: "Runbook",
        slug: "runbook",
        // Owned by someone outside Engineering, so ownership cannot be what
        // grants access below.
        ownerUserId: salesperson,
        status: "live",
      });
      await db.insert(appAccess).values({
        id: newId("access"),
        appId: runbook,
        type: "team",
        targetId: engineering,
      });
    });

    it("opens the app to the team and to nobody else", async () => {
      const { memberRows, appRows, grantRows, teamRows } = await loadContext(halcyon);
      const app = appRows.find((a) => a.slug === "runbook") as App;

      for (const userId of [head, engineer]) {
        expect(
          canAccessApp({
            principal: who(userId, memberRows, teamRows),
            app,
            access: grantRows,
          }),
        ).toBe(true);
      }
      expect(
        canAccessApp({
          principal: who(newHire, memberRows, teamRows),
          app,
          access: grantRows,
        }),
      ).toBe(false);
    });

    it("reaches a new hire the moment they join the team, with no change to the app", async () => {
      await db.insert(teamMembers).values({
        id: newId("teamMember"),
        teamId: engineering,
        userId: newHire,
      });

      const { memberRows, appRows, grantRows, teamRows } = await loadContext(halcyon);
      const app = appRows.find((a) => a.slug === "runbook") as App;

      expect(
        canAccessApp({
          principal: who(newHire, memberRows, teamRows),
          app,
          access: grantRows,
        }),
      ).toBe(true);
      expect(
        (await db.select().from(appAccess).where(eq(appAccess.appId, runbook))).length,
      ).toBe(1);
    });

    it("takes the app away when they leave the team", async () => {
      await db
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, engineering), eq(teamMembers.userId, newHire)));

      const { memberRows, appRows, grantRows, teamRows } = await loadContext(halcyon);

      expect(
        visibleApps({
          principal: who(newHire, memberRows, teamRows),
          apps: appRows,
          access: grantRows,
        }),
      ).toEqual([]);
    });

    it("drops a team's grants with the team", async () => {
      await db.delete(teams).where(eq(teams.id, engineering));

      expect(
        await db.select().from(teamMembers).where(eq(teamMembers.teamId, engineering)),
      ).toEqual([]);

      // The grant row is the app's, not the team's, so it survives - and must
      // now match nobody rather than quietly matching everybody.
      const { memberRows, appRows, grantRows, teamRows } = await loadContext(halcyon);
      const app = appRows.find((a) => a.slug === "runbook") as App;
      expect(
        canAccessApp({
          principal: who(head, memberRows, teamRows),
          app,
          access: grantRows,
        }),
      ).toBe(false);
    });
  });
});
