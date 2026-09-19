import { eq, like } from "drizzle-orm";
import { publicationFor, type CapabilityRisk } from "@cira/core";
import type { Database } from "../client.js";
import {
  appAccess,
  apps,
  capabilities,
  deployments,
  memberships,
  spaces,
  teamMembers,
  teams,
  users,
} from "../schema.js";

/**
 * A whole synthetic company, for looking at.
 *
 * Cira is hard to judge from an empty account: the shape of the product only
 * appears once there is a roster, a dozen apps nobody person can open all of,
 * and grants that disagree with the org chart in the way real ones do. This
 * builds that, in one company, entirely out of invented people.
 *
 * Two rules it holds itself to. Everything it writes is marked - ids begin
 * `..._demo_`, accounts carry a `demo_` external id - so removing the company
 * again is exact rather than a guess. And it uses the product's own rules
 * rather than shortcuts around them: capability publication goes through
 * `publicationFor`, so what is switched on here is what the engine would have
 * switched on.
 */

export const DEMO_SPACE = {
  id: "spc_demo_halcyon",
  name: "Halcyon Labs",
  slug: "halcyon",
  domain: "halcyon.dev",
} as const;

/** Marks every row this file owns, and nothing else. */
const DEMO_MARK = "_demo_";

interface Person {
  key: string;
  name: string;
  title: string;
  role: "owner" | "admin" | "member";
  teams: string[];
}

const PEOPLE: Person[] = [
  {
    key: "ada",
    name: "Ada Whitfield",
    title: "Chief Executive",
    role: "admin",
    teams: [],
  },
  {
    key: "maya",
    name: "Maya Okonkwo",
    title: "VP Engineering",
    role: "admin",
    teams: ["engineering", "platform"],
  },
  {
    key: "tobias",
    name: "Tobias Lund",
    title: "Staff Engineer",
    role: "member",
    teams: ["engineering"],
  },
  {
    key: "priya",
    name: "Priya Raghavan",
    title: "Senior Engineer",
    role: "member",
    teams: ["engineering"],
  },
  {
    key: "dmitri",
    name: "Dmitri Volkov",
    title: "Engineer",
    role: "member",
    teams: ["engineering"],
  },
  {
    key: "nina",
    name: "Nina Castellanos",
    title: "Head of Platform",
    role: "admin",
    teams: ["platform"],
  },
  {
    key: "sam",
    name: "Sam Adeyemi",
    title: "Site Reliability Engineer",
    role: "member",
    teams: ["platform"],
  },
  {
    key: "joonho",
    name: "Joon-ho Park",
    title: "Site Reliability Engineer",
    role: "member",
    teams: ["platform"],
  },
  {
    key: "elena",
    name: "Elena Fischer",
    title: "Head of Design",
    role: "member",
    teams: ["design"],
  },
  {
    key: "marcus",
    name: "Marcus Bell",
    title: "Product Designer",
    role: "member",
    teams: ["design"],
  },
  {
    key: "ruth",
    name: "Ruth Alvarez",
    title: "Director of Product",
    role: "admin",
    teams: ["product", "design"],
  },
  {
    key: "kai",
    name: "Kai Nakamura",
    title: "Product Manager",
    role: "member",
    teams: ["product"],
  },
  {
    key: "farida",
    name: "Farida Hassan",
    title: "Head of Data",
    role: "member",
    teams: ["data"],
  },
  {
    key: "lucas",
    name: "Lucas Moreau",
    title: "Data Scientist",
    role: "member",
    teams: ["data"],
  },
  {
    key: "ingrid",
    name: "Ingrid Sorensen",
    title: "Head of Security",
    role: "admin",
    teams: ["security", "platform"],
  },
  {
    key: "omar",
    name: "Omar Sayeed",
    title: "Security Engineer",
    role: "member",
    teams: ["security"],
  },
  {
    key: "beatrice",
    name: "Beatrice Coleman",
    title: "VP Sales",
    role: "member",
    teams: ["sales"],
  },
  {
    key: "jonah",
    name: "Jonah Reyes",
    title: "Account Executive",
    role: "member",
    teams: ["sales"],
  },
  {
    key: "wen",
    name: "Wen Li",
    title: "Support Lead",
    role: "member",
    teams: ["support"],
  },
  {
    key: "grace",
    name: "Grace Mbeki",
    title: "Support Engineer",
    role: "member",
    teams: ["support"],
  },
  {
    key: "henrik",
    name: "Henrik Dahl",
    title: "Controller",
    role: "member",
    teams: ["finance"],
  },
  {
    key: "sofia",
    name: "Sofia Rinaldi",
    title: "Head of People",
    role: "admin",
    teams: ["people"],
  },
];

const TEAMS: Array<{ slug: string; name: string; description: string }> = [
  {
    slug: "engineering",
    name: "Engineering",
    description: "Builds and runs the product.",
  },
  {
    slug: "platform",
    name: "Platform",
    description: "Infrastructure, deploys and on-call.",
  },
  { slug: "product", name: "Product", description: "Decides what gets built next." },
  { slug: "design", name: "Design", description: "Interface and brand." },
  { slug: "data", name: "Data", description: "Warehouse, models and reporting." },
  { slug: "security", name: "Security", description: "Access, review and response." },
  { slug: "sales", name: "Sales", description: "New business and renewals." },
  { slug: "support", name: "Support", description: "The customer queue." },
  { slug: "finance", name: "Finance", description: "Billing, invoices and the books." },
  { slug: "people", name: "People", description: "Hiring, onboarding and the org." },
];

interface CapabilitySpec {
  name: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  risk: CapabilityRisk;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
}

/** Who an app is given to, in the same three shapes the product offers. */
type Grant = { everyone: true } | { team: string } | { person: string };

interface DemoApp {
  slug: string;
  name: string;
  description: string;
  owner: string;
  grants: Grant[];
  capabilities: CapabilitySpec[];
}

const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
});

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });

export const DEMO_APPS: DemoApp[] = [
  {
    slug: "runbook",
    name: "Runbook",
    description: "Incident console: who is on call, what is burning, and what was tried.",
    owner: "nina",
    grants: [{ team: "engineering" }, { team: "platform" }, { team: "security" }],
    capabilities: [
      {
        name: "listOpenIncidents",
        description: "Every incident that has not been closed, newest first.",
        method: "GET",
        path: "/api/incidents",
        risk: "read",
        input: object({ severity: str("Filter to one severity, e.g. sev1.") }),
        output: object({ incidents: { type: "array", items: object({}) } }),
      },
      {
        name: "getIncident",
        description: "One incident with its timeline and current owner.",
        method: "GET",
        path: "/api/incidents/detail",
        risk: "read",
        input: object({ incidentId: str("The incident to read.") }, ["incidentId"]),
        output: null,
      },
      {
        name: "whoIsOnCall",
        description: "The engineer currently on call for a given rotation.",
        method: "GET",
        path: "/api/on-call",
        risk: "read",
        input: object({ rotation: str("Rotation name, e.g. platform-primary.") }),
        output: object({ name: str("Who is on call."), until: str("ISO timestamp.") }),
      },
      {
        name: "acknowledgeIncident",
        description: "Take ownership of an open incident.",
        method: "POST",
        path: "/api/incidents/acknowledge",
        risk: "write",
        input: object({ incidentId: str("The incident to take.") }, ["incidentId"]),
        output: null,
      },
      {
        name: "pageOnCall",
        description: "Page the on-call engineer for a rotation.",
        method: "POST",
        path: "/api/page",
        risk: "write",
        input: object({ rotation: str("Rotation to page."), reason: str("Why.") }, [
          "rotation",
          "reason",
        ]),
        output: null,
      },
    ],
  },
  {
    slug: "ledger",
    name: "Ledger",
    description: "Invoices, revenue and the monthly close.",
    owner: "henrik",
    // Finance as a team, plus the one salesperson who genuinely needs it. The
    // exception is the point: Sales at large does not get the books.
    grants: [{ team: "finance" }, { person: "beatrice" }],
    capabilities: [
      {
        name: "monthlyRevenue",
        description: "Recognised revenue for a month, by product line.",
        method: "GET",
        path: "/api/revenue",
        risk: "read",
        input: object({ month: str("Month as YYYY-MM.") }, ["month"]),
        output: object({ total: num("Recognised revenue."), currency: str("ISO code.") }),
      },
      {
        name: "listInvoices",
        description: "Invoices in a period, with their payment status.",
        method: "GET",
        path: "/api/invoices",
        risk: "read",
        input: object({
          month: str("Month as YYYY-MM."),
          status: str("paid, open or overdue."),
        }),
        output: null,
      },
      {
        name: "getInvoice",
        description: "One invoice, with its line items.",
        method: "GET",
        path: "/api/invoices/detail",
        risk: "read",
        input: object({ invoiceId: str("The invoice to read.") }, ["invoiceId"]),
        output: null,
      },
      {
        name: "markInvoicePaid",
        description: "Record that an invoice has been settled.",
        method: "POST",
        path: "/api/invoices/mark-paid",
        risk: "write",
        input: object(
          { invoiceId: str("The invoice."), reference: str("Payment reference.") },
          ["invoiceId"],
        ),
        output: null,
      },
      {
        name: "issueRefund",
        description: "Refund a paid invoice in full or in part.",
        method: "POST",
        path: "/api/refunds",
        risk: "write",
        input: object(
          { invoiceId: str("The invoice."), amount: num("Amount to refund.") },
          ["invoiceId", "amount"],
        ),
        output: null,
      },
    ],
  },
  {
    slug: "onboard",
    name: "Onboard",
    description: "New-hire checklists, equipment and first-week scheduling.",
    owner: "sofia",
    grants: [{ everyone: true }],
    capabilities: [
      {
        name: "getOnboardingStatus",
        description: "How far through onboarding a new hire is.",
        method: "GET",
        path: "/api/onboarding/status",
        risk: "read",
        input: object({ email: str("The new hire's work address.") }, ["email"]),
        output: object({
          complete: bool("Everything done?"),
          remaining: num("Tasks left."),
        }),
      },
      {
        name: "listPendingTasks",
        description: "Onboarding tasks still outstanding, across every new hire.",
        method: "GET",
        path: "/api/onboarding/tasks",
        risk: "read",
        input: object({ team: str("Limit to one team.") }),
        output: null,
      },
      {
        name: "completeTask",
        description: "Tick off one onboarding task.",
        method: "POST",
        path: "/api/onboarding/complete",
        risk: "write",
        input: object({ taskId: str("The task.") }, ["taskId"]),
        output: null,
      },
      {
        name: "requestEquipment",
        description: "Order a laptop or peripheral for someone starting.",
        method: "POST",
        path: "/api/equipment/request",
        risk: "write",
        input: object({ email: str("Who it is for."), item: str("What to order.") }, [
          "email",
          "item",
        ]),
        output: null,
      },
    ],
  },
  {
    slug: "compass",
    name: "Compass",
    description: "Account health, renewals and the last thing anyone said to a customer.",
    owner: "beatrice",
    grants: [{ team: "sales" }, { team: "support" }, { team: "product" }],
    capabilities: [
      {
        name: "searchAccounts",
        description: "Find customer accounts by name or domain.",
        method: "GET",
        path: "/api/accounts/search",
        risk: "read",
        input: object({ query: str("Name or domain.") }, ["query"]),
        output: null,
      },
      {
        name: "getAccountHealth",
        description: "Usage, sentiment and open risks for one account.",
        method: "GET",
        path: "/api/accounts/health",
        risk: "read",
        input: object({ accountId: str("The account.") }, ["accountId"]),
        output: object({
          score: num("0 to 100."),
          risks: { type: "array", items: str("A risk.") },
        }),
      },
      {
        name: "listRenewals",
        description: "Contracts coming up for renewal in a window.",
        method: "GET",
        path: "/api/renewals",
        risk: "read",
        input: object({ withinDays: num("How far ahead to look.") }),
        output: null,
      },
      {
        name: "logTouchpoint",
        description: "Record a call or meeting against an account.",
        method: "POST",
        path: "/api/accounts/touchpoint",
        risk: "write",
        input: object({ accountId: str("The account."), note: str("What happened.") }, [
          "accountId",
          "note",
        ]),
        output: null,
      },
    ],
  },
  {
    slug: "pulse",
    name: "Pulse",
    description: "The support queue, triaged.",
    owner: "wen",
    grants: [{ team: "support" }, { team: "engineering" }],
    capabilities: [
      {
        name: "listOpenTickets",
        description: "Unresolved tickets, oldest first.",
        method: "GET",
        path: "/api/tickets",
        risk: "read",
        input: object({ priority: str("Limit to one priority.") }),
        output: null,
      },
      {
        name: "getTicket",
        description: "One ticket with its full conversation.",
        method: "GET",
        path: "/api/tickets/detail",
        risk: "read",
        input: object({ ticketId: str("The ticket.") }, ["ticketId"]),
        output: null,
      },
      {
        name: "assignTicket",
        description: "Give a ticket to a support engineer.",
        method: "POST",
        path: "/api/tickets/assign",
        risk: "write",
        input: object(
          { ticketId: str("The ticket."), assignee: str("Their work address.") },
          ["ticketId", "assignee"],
        ),
        output: null,
      },
      {
        name: "escalateTicket",
        description: "Escalate a ticket to the engineering on-call.",
        method: "POST",
        path: "/api/tickets/escalate",
        risk: "write",
        input: object(
          { ticketId: str("The ticket."), reason: str("Why it cannot wait.") },
          ["ticketId", "reason"],
        ),
        output: null,
      },
    ],
  },
  {
    slug: "atlas",
    name: "Atlas",
    description: "The data catalogue: what tables exist, who owns them, what is fresh.",
    owner: "farida",
    grants: [{ team: "data" }, { team: "engineering" }, { team: "product" }],
    capabilities: [
      {
        name: "searchDatasets",
        description: "Find a table or model by name, owner or description.",
        method: "GET",
        path: "/api/datasets/search",
        risk: "read",
        input: object({ query: str("What to look for.") }, ["query"]),
        output: null,
      },
      {
        name: "getDatasetSchema",
        description: "Columns, types and freshness for one dataset.",
        method: "GET",
        path: "/api/datasets/schema",
        risk: "read",
        input: object({ dataset: str("Fully qualified name.") }, ["dataset"]),
        output: null,
      },
      {
        name: "runSavedQuery",
        description: "Run a query someone has already reviewed and saved.",
        method: "GET",
        path: "/api/queries/run",
        risk: "read",
        input: object({ queryId: str("The saved query.") }, ["queryId"]),
        output: null,
      },
      {
        name: "refreshMaterialization",
        description: "Rebuild a materialised table ahead of its schedule.",
        method: "POST",
        path: "/api/datasets/refresh",
        risk: "write",
        input: object({ dataset: str("What to rebuild.") }, ["dataset"]),
        output: null,
      },
    ],
  },
  {
    slug: "keyring",
    name: "Keyring",
    description: "Access requests, approvals and the quarterly review.",
    owner: "ingrid",
    // Security, and the head of platform by name. Deliberately narrow.
    grants: [{ team: "security" }, { person: "nina" }],
    capabilities: [
      {
        name: "listAccessRequests",
        description: "Requests waiting on a decision.",
        method: "GET",
        path: "/api/requests",
        risk: "read",
        input: object({ system: str("Limit to one system.") }),
        output: null,
      },
      {
        name: "getRequest",
        description: "One request, with who asked and why.",
        method: "GET",
        path: "/api/requests/detail",
        risk: "read",
        input: object({ requestId: str("The request.") }, ["requestId"]),
        output: null,
      },
      {
        name: "approveAccessRequest",
        description: "Grant a pending access request.",
        method: "POST",
        path: "/api/requests/approve",
        risk: "write",
        input: object({ requestId: str("The request.") }, ["requestId"]),
        output: null,
      },
      {
        name: "revokeAccess",
        description: "Remove someone's access to a system immediately.",
        method: "POST",
        path: "/api/access/revoke",
        risk: "write",
        input: object({ email: str("Whose access."), system: str("Which system.") }, [
          "email",
          "system",
        ]),
        output: null,
      },
    ],
  },
  {
    slug: "storefront-admin",
    name: "Storefront Admin",
    description: "Customer records, subscriptions and plan changes.",
    owner: "maya",
    grants: [{ team: "engineering" }, { team: "support" }],
    capabilities: [
      {
        name: "lookupCustomer",
        description: "Find a customer by email or account id.",
        method: "GET",
        path: "/api/customers/lookup",
        risk: "read",
        input: object({ query: str("Email or account id.") }, ["query"]),
        output: null,
      },
      {
        name: "listSubscriptions",
        description: "Every subscription on an account, with its plan and term.",
        method: "GET",
        path: "/api/subscriptions",
        risk: "read",
        input: object({ accountId: str("The account.") }, ["accountId"]),
        output: null,
      },
      {
        name: "changePlan",
        description: "Move a subscription to a different plan.",
        method: "POST",
        path: "/api/subscriptions/change-plan",
        risk: "write",
        input: object(
          { subscriptionId: str("The subscription."), plan: str("The new plan.") },
          ["subscriptionId", "plan"],
        ),
        output: null,
      },
      {
        name: "deleteCustomerData",
        description: "Erase a customer's records for a deletion request.",
        method: "POST",
        path: "/api/customers/delete",
        risk: "write",
        input: object({ accountId: str("The account to erase.") }, ["accountId"]),
        output: null,
      },
    ],
  },
  {
    slug: "beacon",
    name: "Beacon",
    description: "Feature flags and staged rollouts.",
    owner: "kai",
    grants: [{ team: "engineering" }, { team: "product" }, { team: "design" }],
    capabilities: [
      {
        name: "listFlags",
        description: "Every flag, with where it is rolled out to.",
        method: "GET",
        path: "/api/flags",
        risk: "read",
        input: object({ environment: str("production or staging.") }),
        output: null,
      },
      {
        name: "getFlag",
        description: "One flag's current state and history.",
        method: "GET",
        path: "/api/flags/detail",
        risk: "read",
        input: object({ flag: str("The flag key.") }, ["flag"]),
        output: null,
      },
      {
        name: "setFlagRollout",
        description: "Change what share of traffic a flag is on for.",
        method: "POST",
        path: "/api/flags/rollout",
        risk: "write",
        input: object({ flag: str("The flag key."), percent: num("0 to 100.") }, [
          "flag",
          "percent",
        ]),
        output: null,
      },
      {
        name: "killFlag",
        description: "Turn a flag off everywhere and delete its rollout.",
        method: "POST",
        path: "/api/flags/kill",
        risk: "write",
        input: object({ flag: str("The flag key.") }, ["flag"]),
        output: null,
      },
    ],
  },
  {
    slug: "roster",
    name: "Roster",
    description: "The org chart, open roles and who reports to whom.",
    owner: "sofia",
    grants: [{ everyone: true }],
    capabilities: [
      {
        name: "findPerson",
        description: "Look someone up by name, team or title.",
        method: "GET",
        path: "/api/people/search",
        risk: "read",
        input: object({ query: str("Name, team or title.") }, ["query"]),
        output: null,
      },
      {
        name: "getTeam",
        description: "Everyone on a team, with their manager.",
        method: "GET",
        path: "/api/teams",
        risk: "read",
        input: object({ team: str("The team's name.") }, ["team"]),
        output: null,
      },
      {
        name: "listOpenRoles",
        description: "Roles currently being hired for.",
        method: "GET",
        path: "/api/roles",
        risk: "read",
        input: object({ team: str("Limit to one team.") }),
        output: null,
      },
    ],
  },
];

export interface SeedResult {
  spaceSlug: string;
  people: number;
  teams: number;
  apps: number;
  capabilities: number;
  enabledCapabilities: number;
  grants: number;
  ownerName: string;
}

export interface SeedOptions {
  /**
   * An existing Cira account to make the owner of the company.
   *
   * Without one the space would be twenty-two people none of whom can sign in,
   * which is a company nobody can look at. Required for that reason rather
   * than for any technical one.
   */
  ownerEmail: string;
  /**
   * Further real accounts to drop into the company as admins.
   *
   * One machine often has more than one Cira login sitting in it - a personal
   * one and a test one - and a demo only the other tab can see is not a demo.
   */
  alsoEmails?: string[];
  /**
   * Where the synthetic apps appear to be deployed.
   *
   * Pointed at Cira's own `/demo` route rather than at an invented hostname,
   * so that pressing Open lands somewhere that explains itself instead of on a
   * DNS error.
   */
  origin: string;
}

export async function seedDemoOrg(
  database: Database,
  options: SeedOptions,
): Promise<SeedResult> {
  const owner = await realAccount(database, options.ownerEmail);
  const guests = [];
  for (const email of options.alsoEmails ?? []) {
    const account = await realAccount(database, email);
    if (account.id !== owner.id) guests.push(account);
  }

  await removeDemoOrg(database);

  await database.insert(spaces).values({ ...DEMO_SPACE });

  await database.insert(users).values(
    PEOPLE.map((person) => ({
      id: personId(person.key),
      externalId: `demo_${person.key}`,
      name: person.name,
      email: `${person.key}@${DEMO_SPACE.domain}`,
    })),
  );

  await database.insert(memberships).values([
    // The real account first, and as owner: whoever ran this is looking at the
    // company from the top of it.
    {
      id: `mem${DEMO_MARK}owner`,
      userId: owner.id,
      spaceId: DEMO_SPACE.id,
      role: "owner" as const,
    },
    ...guests.map((guest, index) => ({
      id: `mem${DEMO_MARK}guest_${index}`,
      userId: guest.id,
      spaceId: DEMO_SPACE.id,
      role: "admin" as const,
    })),
    ...PEOPLE.map((person) => ({
      id: `mem${DEMO_MARK}${person.key}`,
      userId: personId(person.key),
      spaceId: DEMO_SPACE.id,
      role: person.role,
    })),
  ]);

  await database.insert(teams).values(
    TEAMS.map((team) => ({
      id: teamId(team.slug),
      spaceId: DEMO_SPACE.id,
      name: team.name,
      slug: team.slug,
      description: team.description,
    })),
  );

  const rosters = PEOPLE.flatMap((person) =>
    person.teams.map((team) => ({
      id: `tmm${DEMO_MARK}${person.key}_${team}`,
      teamId: teamId(team),
      userId: personId(person.key),
    })),
  );
  await database.insert(teamMembers).values(rosters);

  await database.insert(apps).values(
    DEMO_APPS.map((app) => ({
      id: appId(app.slug),
      spaceId: DEMO_SPACE.id,
      name: app.name,
      slug: app.slug,
      description: app.description,
      status: "live" as const,
      ownerUserId: personId(app.owner),
    })),
  );

  await database.insert(deployments).values(
    DEMO_APPS.map((app) => ({
      id: `dep${DEMO_MARK}${app.slug}`,
      appId: appId(app.slug),
      provider: "demo",
      providerDeploymentId: `demo_${app.slug}`,
      status: "live" as const,
      url: `${options.origin.replace(/\/+$/, "")}/demo/${DEMO_SPACE.slug}/${app.slug}`,
    })),
  );

  const grants = DEMO_APPS.flatMap((app) =>
    app.grants.map((grant, index) => ({
      id: `acc${DEMO_MARK}${app.slug}_${index}`,
      appId: appId(app.slug),
      ...("everyone" in grant
        ? { type: "space" as const, targetId: DEMO_SPACE.id }
        : "team" in grant
          ? { type: "team" as const, targetId: teamId(grant.team) }
          : { type: "user" as const, targetId: personId(grant.person) }),
    })),
  );
  await database.insert(appAccess).values(grants);

  const capabilityRows = DEMO_APPS.flatMap((app) =>
    app.capabilities.map((capability) => ({
      id: `cap${DEMO_MARK}${app.slug}_${capability.name}`,
      appId: appId(app.slug),
      spaceId: DEMO_SPACE.id,
      name: capability.name,
      description: capability.description,
      inputSchema: capability.input,
      outputSchema: capability.output,
      method: capability.method,
      path: capability.path,
      risk: capability.risk,
      // The product's own policy, not a hand-picked flag: reads are live and
      // anything that changes something waits for a person.
      enabled: publicationFor({ risk: capability.risk }).enabled,
      // Seeded apps are not deployed, so nothing could have confirmed these.
      // Stamped anyway, because a demo with everything greyed out shows
      // nothing.
      verifiedAt: new Date(),
    })),
  );
  await database.insert(capabilities).values(capabilityRows);

  return {
    spaceSlug: DEMO_SPACE.slug,
    people: PEOPLE.length + 1 + guests.length,
    teams: TEAMS.length,
    apps: DEMO_APPS.length,
    capabilities: capabilityRows.length,
    enabledCapabilities: capabilityRows.filter((c) => c.enabled).length,
    grants: grants.length,
    ownerName: owner.name,
  };
}

/**
 * Take the company away again.
 *
 * The space cascades to its apps, grants, capabilities and memberships, which
 * leaves only the invented accounts - deleted by their marked external id, so
 * a real person who happens to work at a company called Halcyon is never
 * caught by it.
 */
export async function removeDemoOrg(database: Database): Promise<void> {
  await database.delete(spaces).where(eq(spaces.id, DEMO_SPACE.id));
  await database.delete(users).where(like(users.externalId, "demo\\_%"));
}

async function realAccount(
  database: Database,
  email: string,
): Promise<{ id: string; name: string }> {
  const [account] = await database
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);

  if (account === undefined) {
    throw new Error(
      `No Cira account with the address ${email}. Sign in to Cira once with it, then run this again.`,
    );
  }
  return account;
}

function personId(key: string): string {
  return `usr${DEMO_MARK}${key}`;
}

function teamId(slug: string): string {
  return `tem${DEMO_MARK}${slug}`;
}

function appId(slug: string): string {
  return `app${DEMO_MARK}${slug}`;
}
