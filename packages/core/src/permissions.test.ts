import { describe, expect, it } from "vitest";
import {
  canAccessApp,
  canDeployToSpace,
  canInviteToSpace,
  canManageApp,
  roleAtLeast,
  visibleApps,
} from "./permissions.js";
import type { App, AppAccess, Membership, Role } from "./model.js";
import type { Principal } from "./permissions.js";

const ACME = "space_acme";
const OTHER = "space_other";

function member(userId: string, spaceId: string, role: Role): Membership {
  return { id: `m_${userId}_${spaceId}`, userId, spaceId, role };
}

function app(overrides: Partial<App> = {}): App {
  return {
    id: "app_revenue",
    spaceId: ACME,
    name: "Revenue Dashboard",
    slug: "revenue-dashboard",
    description: null,
    status: "live",
    icon: null,
    ownerUserId: "user_dev",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function grantUser(appId: string, userId: string): AppAccess {
  return {
    id: `a_${appId}_${userId}`,
    appId,
    type: "user",
    targetId: userId,
    level: "use",
  };
}

function grantSpace(appId: string, spaceId: string): AppAccess {
  return {
    id: `a_${appId}_${spaceId}`,
    appId,
    type: "space",
    targetId: spaceId,
    level: "use",
  };
}

function grantTeam(appId: string, teamId: string): AppAccess {
  return {
    id: `a_${appId}_${teamId}`,
    appId,
    type: "team",
    targetId: teamId,
    level: "use",
  };
}

describe("roleAtLeast", () => {
  it("ranks member below admin below owner", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("member", "admin")).toBe(false);
  });
});

describe("canAccessApp", () => {
  const memberships = [
    member("user_dev", ACME, "member"),
    member("user_emp", ACME, "member"),
    member("user_admin", ACME, "admin"),
    member("user_outsider", OTHER, "owner"),
  ];

  const who = (userId: string, teamIds: string[] = []): Principal => ({
    userId,
    memberships,
    teamIds,
  });

  it("denies a user who is not in the app's space", () => {
    expect(
      canAccessApp({
        principal: who("user_outsider"),
        app: app(),
        access: [grantSpace("app_revenue", ACME)],
      }),
    ).toBe(false);
  });

  it("denies a space member with no grant", () => {
    expect(canAccessApp({ principal: who("user_emp"), app: app(), access: [] })).toBe(
      false,
    );
  });

  it("allows a space member named by a user grant", () => {
    expect(
      canAccessApp({
        principal: who("user_emp"),
        app: app(),
        access: [grantUser("app_revenue", "user_emp")],
      }),
    ).toBe(true);
  });

  it("allows every member under a space-wide grant", () => {
    expect(
      canAccessApp({
        principal: who("user_emp"),
        app: app(),
        access: [grantSpace("app_revenue", ACME)],
      }),
    ).toBe(true);
  });

  it("allows the owner even with no grant at all", () => {
    expect(canAccessApp({ principal: who("user_dev"), app: app(), access: [] })).toBe(
      true,
    );
  });

  it("allows a space admin even with no grant", () => {
    expect(canAccessApp({ principal: who("user_admin"), app: app(), access: [] })).toBe(
      true,
    );
  });

  it("ignores grants that belong to a different app", () => {
    expect(
      canAccessApp({
        principal: who("user_emp"),
        app: app(),
        access: [grantUser("app_invoices", "user_emp")],
      }),
    ).toBe(false);
  });

  it("does not let a space grant for another space leak access", () => {
    expect(
      canAccessApp({
        principal: who("user_emp"),
        app: app(),
        access: [grantSpace("app_revenue", OTHER)],
      }),
    ).toBe(false);
  });

  it("allows a member of a team the app names", () => {
    expect(
      canAccessApp({
        principal: who("user_emp", ["team_support"]),
        app: app(),
        access: [grantTeam("app_revenue", "team_support")],
      }),
    ).toBe(true);
  });

  it("denies someone on a different team", () => {
    expect(
      canAccessApp({
        principal: who("user_emp", ["team_sales"]),
        app: app(),
        access: [grantTeam("app_revenue", "team_support")],
      }),
    ).toBe(false);
  });

  it("denies a team grant to someone on no team at all", () => {
    expect(
      canAccessApp({
        principal: who("user_emp"),
        app: app(),
        access: [grantTeam("app_revenue", "team_support")],
      }),
    ).toBe(false);
  });

  it("still requires space membership, whatever teams say", () => {
    // The outsider is on the named team but belongs to another company. A team
    // grant must never be a way around the space check.
    expect(
      canAccessApp({
        principal: who("user_outsider", ["team_support"]),
        app: app(),
        access: [grantTeam("app_revenue", "team_support")],
      }),
    ).toBe(false);
  });
});

describe("canManageApp", () => {
  const memberships = [
    member("user_dev", ACME, "member"),
    member("user_emp", ACME, "member"),
    member("user_eng", ACME, "member"),
    member("user_admin", ACME, "admin"),
  ];
  const as = (userId: string, teamIds: string[] = []): Principal => ({
    userId,
    memberships,
    teamIds,
  });
  const grant = (
    type: AppAccess["type"],
    targetId: string,
    level: AppAccess["level"],
  ): AppAccess => ({
    id: `g_${type}_${targetId}`,
    appId: "app_revenue",
    type,
    targetId,
    level,
  });

  it("lets the owner manage their own app", () => {
    expect(canManageApp({ principal: as("user_dev"), app: app(), access: [] })).toBe(
      true,
    );
  });

  it("lets a space admin manage any app", () => {
    expect(canManageApp({ principal: as("user_admin"), app: app(), access: [] })).toBe(
      true,
    );
  });

  it("refuses a plain member, even one who can open the app", () => {
    const access = [grant("user", "user_emp", "use"), grant("space", ACME, "use")];
    expect(canManageApp({ principal: as("user_emp"), app: app(), access })).toBe(false);
  });

  it("lets someone manage through a manage grant to them or their team", () => {
    expect(
      canManageApp({
        principal: as("user_eng"),
        app: app(),
        access: [grant("user", "user_eng", "manage")],
      }),
    ).toBe(true);
    expect(
      canManageApp({
        principal: as("user_eng", ["team_platform"]),
        app: app(),
        access: [grant("team", "team_platform", "manage")],
      }),
    ).toBe(true);
  });

  it("never lets a grant to the whole space make everyone a manager", () => {
    expect(
      canManageApp({
        principal: as("user_emp"),
        app: app(),
        access: [grant("space", ACME, "manage")],
      }),
    ).toBe(false);
  });

  it("refuses anyone outside the space, whatever the grants say", () => {
    expect(
      canManageApp({
        principal: { userId: "user_ghost", memberships, teamIds: [] },
        app: app(),
        access: [grant("user", "user_ghost", "manage")],
      }),
    ).toBe(false);
  });

  it("ignores a manage grant that belongs to another app", () => {
    const other = { ...grant("user", "user_eng", "manage"), appId: "app_other" };
    expect(canManageApp({ principal: as("user_eng"), app: app(), access: [other] })).toBe(
      false,
    );
  });
});

describe("space actions", () => {
  const memberships = [
    member("user_emp", ACME, "member"),
    member("user_admin", ACME, "admin"),
  ];

  it("restricts invites to admins and owners", () => {
    expect(canInviteToSpace({ userId: "user_admin", spaceId: ACME, memberships })).toBe(
      true,
    );
    expect(canInviteToSpace({ userId: "user_emp", spaceId: ACME, memberships })).toBe(
      false,
    );
  });

  it("lets any member deploy, but no one outside the space", () => {
    expect(canDeployToSpace({ userId: "user_emp", spaceId: ACME, memberships })).toBe(
      true,
    );
    expect(canDeployToSpace({ userId: "user_ghost", spaceId: ACME, memberships })).toBe(
      false,
    );
  });
});

describe("visibleApps", () => {
  it("returns only the apps the employee was actually granted", () => {
    const revenue = app({ id: "app_revenue", slug: "revenue-dashboard" });
    const invoices = app({ id: "app_invoices", slug: "invoice-matcher" });
    const leads = app({ id: "app_leads", slug: "lead-cleaner" });

    const visible = visibleApps({
      principal: {
        userId: "user_emp",
        memberships: [member("user_emp", ACME, "member")],
        teamIds: [],
      },
      apps: [revenue, invoices, leads],
      access: [grantUser("app_revenue", "user_emp"), grantSpace("app_leads", ACME)],
    });

    expect(visible.map((a) => a.id)).toEqual(["app_revenue", "app_leads"]);
  });

  it("includes what a team grant reaches", () => {
    const runbook = app({ id: "app_runbook", slug: "runbook" });
    const ledger = app({ id: "app_ledger", slug: "ledger" });

    const visible = visibleApps({
      principal: {
        userId: "user_emp",
        memberships: [member("user_emp", ACME, "member")],
        teamIds: ["team_eng"],
      },
      apps: [runbook, ledger],
      access: [grantTeam("app_runbook", "team_eng"), grantTeam("app_ledger", "team_fin")],
    });

    expect(visible.map((a) => a.id)).toEqual(["app_runbook"]);
  });
});
