/**
 * What the demo company's apps say when they are asked something.
 *
 * Halcyon Labs is invented - its apps are rows in a table with nothing
 * running behind them - and until this existed every one of its forty-one
 * capabilities could be found and described and then not called, which made
 * the demo a tour of things that do not work. These answers let the whole
 * loop run there: an agent or Ask Cira searches, describes, invokes, and gets
 * something back that looks like what a real internal tool would say.
 *
 * Deterministic on purpose. The same question gets the same answer, so a demo
 * rehearsed on Monday goes the same way on Thursday, and numbers that are
 * made from their input (a month's revenue from the month) stay consistent
 * across follow-up questions. The people are the seeded roster, so asking
 * Roster who is on the platform team names the same people the members page
 * shows.
 *
 * Only reached for a deployment the seed created (`provider: "demo"`), which
 * no real app can have.
 */

type Input = Record<string, unknown>;
type Answer = (input: Input) => unknown;

const text = (input: Input, key: string): string => {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
};

const has = (haystack: string, needle: string) =>
  needle === "" || haystack.toLowerCase().includes(needle.toLowerCase());

/** A stable number from a string, so answers can vary by input and never by day. */
function seed(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (days: number) =>
  new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

const PEOPLE = [
  { name: "Ada Whitfield", title: "Chief Executive", team: "leadership" },
  { name: "Maya Okonkwo", title: "VP Engineering", team: "engineering" },
  { name: "Tobias Lund", title: "Staff Engineer", team: "engineering" },
  { name: "Priya Raghavan", title: "Senior Engineer", team: "engineering" },
  { name: "Dmitri Volkov", title: "Engineer", team: "engineering" },
  { name: "Nina Castellanos", title: "Head of Platform", team: "platform" },
  { name: "Sam Adeyemi", title: "Site Reliability Engineer", team: "platform" },
  { name: "Joon-ho Park", title: "Site Reliability Engineer", team: "platform" },
  { name: "Elena Fischer", title: "Head of Design", team: "design" },
  { name: "Marcus Bell", title: "Product Designer", team: "design" },
  { name: "Ruth Alvarez", title: "Director of Product", team: "product" },
  { name: "Kai Nakamura", title: "Product Manager", team: "product" },
  { name: "Farida Hassan", title: "Head of Data", team: "data" },
  { name: "Lucas Moreau", title: "Data Scientist", team: "data" },
  { name: "Ingrid Sorensen", title: "Head of Security", team: "security" },
  { name: "Omar Sayeed", title: "Security Engineer", team: "security" },
  { name: "Beatrice Coleman", title: "VP Sales", team: "sales" },
  { name: "Jonah Reyes", title: "Account Executive", team: "sales" },
  { name: "Wen Li", title: "Support Lead", team: "support" },
  { name: "Grace Mbeki", title: "Support Engineer", team: "support" },
  { name: "Henrik Dahl", title: "Controller", team: "finance" },
  { name: "Sofia Rinaldi", title: "Head of People", team: "people" },
].map((person) => ({
  ...person,
  email: `${person.name
    .toLowerCase()
    .split(" ")[0]
    ?.replace(/[^a-z]/g, "")}@halcyon.dev`,
}));

const MANAGERS: Record<string, string> = {
  engineering: "Maya Okonkwo",
  platform: "Nina Castellanos",
  design: "Elena Fischer",
  product: "Ruth Alvarez",
  data: "Farida Hassan",
  security: "Ingrid Sorensen",
  sales: "Beatrice Coleman",
  support: "Wen Li",
  finance: "Henrik Dahl",
  people: "Sofia Rinaldi",
};

const ACCOUNTS = [
  {
    accountId: "acc_acme",
    name: "Acme Freight",
    domain: "acmefreight.com",
    plan: "Enterprise",
    arr: 184000,
    renews: 21,
  },
  {
    accountId: "acc_northwind",
    name: "Northwind Health",
    domain: "northwind.health",
    plan: "Growth",
    arr: 62000,
    renews: 48,
  },
  {
    accountId: "acc_orbital",
    name: "Orbital Foods",
    domain: "orbitalfoods.co",
    plan: "Growth",
    arr: 41500,
    renews: 77,
  },
  {
    accountId: "acc_lumen",
    name: "Lumen Bank",
    domain: "lumenbank.com",
    plan: "Enterprise",
    arr: 236000,
    renews: 133,
  },
  {
    accountId: "acc_kestrel",
    name: "Kestrel Air",
    domain: "kestrel.aero",
    plan: "Starter",
    arr: 9800,
    renews: 12,
  },
];

const INVOICES = [
  {
    invoiceId: "INV-2038",
    account: "Lumen Bank",
    amount: 19666.67,
    status: "paid",
    issued: 34,
  },
  {
    invoiceId: "INV-2039",
    account: "Acme Freight",
    amount: 15333.33,
    status: "paid",
    issued: 30,
  },
  {
    invoiceId: "INV-2040",
    account: "Northwind Health",
    amount: 5166.67,
    status: "open",
    issued: 12,
  },
  {
    invoiceId: "INV-2041",
    account: "Acme Freight",
    amount: 120.0,
    status: "paid",
    issued: 9,
  },
  {
    invoiceId: "INV-2042",
    account: "Orbital Foods",
    amount: 3458.33,
    status: "overdue",
    issued: 41,
  },
  {
    invoiceId: "INV-2043",
    account: "Kestrel Air",
    amount: 816.67,
    status: "open",
    issued: 4,
  },
];

const INCIDENTS = [
  {
    incidentId: "INC-417",
    title: "Checkout latency above 2s in eu-west",
    severity: "sev2",
    owner: "Sam Adeyemi",
    opened: 2.5 * 60 * 60 * 1000,
    timeline: [
      "Latency alert fired on the checkout service",
      "Sam acknowledged and began investigating",
      "Traced to a slow query on the orders replica",
    ],
  },
  {
    incidentId: "INC-416",
    title: "Nightly export to the warehouse failed",
    severity: "sev3",
    owner: "Lucas Moreau",
    opened: 9 * 60 * 60 * 1000,
    timeline: ["Export job exited with a timeout", "Retried once, same result"],
  },
  {
    incidentId: "INC-414",
    title: "Intermittent 502s from the image service",
    severity: "sev3",
    owner: null,
    opened: 26 * 60 * 60 * 1000,
    timeline: ["Error rate briefly crossed 1%", "Recovered on its own; cause unknown"],
  },
];

const TICKETS = [
  {
    ticketId: "T-8812",
    subject: "Invoices show the wrong tax rate",
    account: "Northwind Health",
    priority: "high",
    age: 3,
  },
  {
    ticketId: "T-8807",
    subject: "SSO login loops back to the sign-in page",
    account: "Lumen Bank",
    priority: "urgent",
    age: 1,
  },
  {
    ticketId: "T-8799",
    subject: "Export to CSV drops the last row",
    account: "Orbital Foods",
    priority: "normal",
    age: 6,
  },
  {
    ticketId: "T-8790",
    subject: "Question about adding more seats",
    account: "Kestrel Air",
    priority: "low",
    age: 9,
  },
];

const DATASETS = [
  {
    dataset: "analytics.accounts_daily",
    owner: "Farida Hassan",
    description: "One row per account per day: usage, seats and plan.",
  },
  {
    dataset: "analytics.revenue_monthly",
    owner: "Henrik Dahl",
    description: "Recognised revenue by month and product line.",
  },
  {
    dataset: "support.tickets",
    owner: "Wen Li",
    description: "Every support ticket with its status and timings.",
  },
  {
    dataset: "product.events",
    owner: "Lucas Moreau",
    description: "Raw product events, partitioned by day.",
  },
];

const REQUESTS = [
  {
    requestId: "REQ-311",
    who: "Dmitri Volkov",
    system: "production-db",
    access: "read-only",
    why: "Investigating INC-417",
    age: 1,
  },
  {
    requestId: "REQ-309",
    who: "Jonah Reyes",
    system: "billing",
    access: "viewer",
    why: "Checking invoice history for Acme Freight",
    age: 4,
  },
  {
    requestId: "REQ-305",
    who: "Marcus Bell",
    system: "analytics",
    access: "editor",
    why: "Building the onboarding funnel dashboard",
    age: 7,
  },
];

const FLAGS = [
  {
    flag: "new-checkout",
    description: "The redesigned checkout flow",
    production: 25,
    staging: 100,
  },
  {
    flag: "usage-alerts",
    description: "Email accounts when they near their seat limit",
    production: 100,
    staging: 100,
  },
  {
    flag: "ai-summaries",
    description: "Summaries on the ticket view",
    production: 0,
    staging: 50,
  },
];

const NEW_HIRES = [
  {
    name: "Lena Berg",
    email: "lena@halcyon.dev",
    team: "engineering",
    starts: -3,
    done: 9,
    total: 14,
  },
  {
    name: "Arjun Mehta",
    email: "arjun@halcyon.dev",
    team: "sales",
    starts: 4,
    done: 3,
    total: 11,
  },
];

const ROLES = [
  { role: "Senior Backend Engineer", team: "engineering", openFor: 38 },
  { role: "Site Reliability Engineer", team: "platform", openFor: 12 },
  { role: "Account Executive, EMEA", team: "sales", openFor: 21 },
];

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function revenueFor(month: string) {
  const r = seed(month);
  const platform = money(318000 + r * 42000);
  const analytics = money(97000 + seed(`${month}a`) * 18000);
  const support = money(41000 + seed(`${month}s`) * 9000);
  return {
    month,
    currency: "USD",
    total: money(platform + analytics + support),
    byProductLine: [
      { productLine: "Platform", revenue: platform },
      { productLine: "Analytics", revenue: analytics },
      { productLine: "Support plans", revenue: support },
    ],
  };
}

const ANSWERS: Record<string, Record<string, Answer>> = {
  runbook: {
    listOpenIncidents: (input) => ({
      incidents: INCIDENTS.filter((i) => has(i.severity, text(input, "severity"))).map(
        (i) => ({
          incidentId: i.incidentId,
          title: i.title,
          severity: i.severity,
          owner: i.owner,
          openedAt: ago(i.opened),
        }),
      ),
    }),
    getIncident: (input) => {
      const found = INCIDENTS.find(
        (i) => i.incidentId.toLowerCase() === text(input, "incidentId").toLowerCase(),
      );
      return found === undefined
        ? { found: false }
        : { ...found, opened: undefined, openedAt: ago(found.opened), status: "open" };
    },
    whoIsOnCall: (input) => {
      const rotation = text(input, "rotation") || "platform-primary";
      const person = rotation.includes("secondary") ? "Joon-ho Park" : "Sam Adeyemi";
      return { rotation, onCall: person, until: ahead(3), backup: "Nina Castellanos" };
    },
    acknowledgeIncident: (input) => ({
      ok: true,
      incidentId: text(input, "incidentId"),
      owner: "you",
    }),
    pageOnCall: (input) => ({
      ok: true,
      paged: "Sam Adeyemi",
      rotation: text(input, "rotation") || "platform-primary",
    }),
  },

  ledger: {
    monthlyRevenue: (input) => revenueFor(text(input, "month") || thisMonth()),
    listInvoices: (input) => ({
      month: text(input, "month") || thisMonth(),
      invoices: INVOICES.filter((i) => has(i.status, text(input, "status"))).map((i) => ({
        invoiceId: i.invoiceId,
        account: i.account,
        amount: i.amount,
        currency: "USD",
        status: i.status,
        issuedOn: ago(i.issued * DAY).slice(0, 10),
      })),
    }),
    getInvoice: (input) => {
      const found = INVOICES.find(
        (i) => i.invoiceId.toLowerCase() === text(input, "invoiceId").toLowerCase(),
      );
      if (found === undefined) return { found: false };
      return {
        invoiceId: found.invoiceId,
        account: found.account,
        status: found.status,
        currency: "USD",
        total: found.amount,
        lines: [{ description: "Subscription", amount: found.amount }],
      };
    },
    markInvoicePaid: (input) => ({
      ok: true,
      invoiceId: text(input, "invoiceId"),
      status: "paid",
    }),
    issueRefund: (input) => ({
      ok: true,
      refundId: `RF-${Math.floor(seed(text(input, "invoiceId")) * 9000 + 1000)}`,
      invoiceId: text(input, "invoiceId"),
      amount: input["amount"],
      currency: "USD",
    }),
  },

  onboard: {
    getOnboardingStatus: (input) => {
      const hire = NEW_HIRES.find((h) => h.email === text(input, "email").toLowerCase());
      if (hire === undefined) return { found: false };
      return {
        name: hire.name,
        team: hire.team,
        startsOn: ahead(hire.starts),
        tasksDone: hire.done,
        tasksTotal: hire.total,
      };
    },
    listPendingTasks: (input) => ({
      tasks: [
        {
          taskId: "OB-71",
          who: "Lena Berg",
          task: "Security training",
          due: ahead(2),
          team: "engineering",
        },
        {
          taskId: "OB-72",
          who: "Lena Berg",
          task: "Set up production access",
          due: ahead(5),
          team: "engineering",
        },
        {
          taskId: "OB-80",
          who: "Arjun Mehta",
          task: "Laptop delivered",
          due: ahead(3),
          team: "sales",
        },
        {
          taskId: "OB-81",
          who: "Arjun Mehta",
          task: "CRM account created",
          due: ahead(4),
          team: "sales",
        },
      ].filter((t) => has(t.team, text(input, "team"))),
    }),
    completeTask: (input) => ({
      ok: true,
      taskId: text(input, "taskId"),
      status: "done",
    }),
    requestEquipment: (input) => ({
      ok: true,
      orderId: "EQ-5520",
      for: text(input, "email"),
      item: text(input, "item"),
      arrives: ahead(3),
    }),
  },

  compass: {
    searchAccounts: (input) => ({
      accounts: ACCOUNTS.filter((a) =>
        has(`${a.name} ${a.domain}`, text(input, "query")),
      ).map(({ accountId, name, domain, plan }) => ({ accountId, name, domain, plan })),
    }),
    getAccountHealth: (input) => {
      const account = ACCOUNTS.find((a) => a.accountId === text(input, "accountId"));
      if (account === undefined) return { found: false };
      const r = seed(account.accountId);
      return {
        name: account.name,
        health: r > 0.66 ? "healthy" : r > 0.33 ? "watch" : "at risk",
        weeklyActiveSeats: Math.round(40 + r * 260),
        sentiment: r > 0.5 ? "positive" : "mixed",
        openRisks: r > 0.5 ? [] : ["Usage down 18% over the last month"],
      };
    },
    listRenewals: (input) => {
      const within = typeof input["withinDays"] === "number" ? input["withinDays"] : 90;
      return {
        withinDays: within,
        renewals: ACCOUNTS.filter((a) => a.renews <= within)
          .sort((a, b) => a.renews - b.renews)
          .map((a) => ({
            account: a.name,
            plan: a.plan,
            arr: a.arr,
            currency: "USD",
            renewsOn: ahead(a.renews),
          })),
      };
    },
    logTouchpoint: (input) => ({
      ok: true,
      accountId: text(input, "accountId"),
      loggedAt: new Date().toISOString(),
    }),
  },

  pulse: {
    listOpenTickets: (input) => ({
      tickets: TICKETS.filter((t) => has(t.priority, text(input, "priority")))
        .sort((a, b) => b.age - a.age)
        .map((t) => ({
          ticketId: t.ticketId,
          subject: t.subject,
          account: t.account,
          priority: t.priority,
          openedOn: ago(t.age * DAY).slice(0, 10),
        })),
    }),
    getTicket: (input) => {
      const found = TICKETS.find(
        (t) => t.ticketId.toLowerCase() === text(input, "ticketId").toLowerCase(),
      );
      if (found === undefined) return { found: false };
      return {
        ...found,
        age: undefined,
        openedOn: ago(found.age * DAY).slice(0, 10),
        assignee: "Grace Mbeki",
        conversation: [
          { from: found.account, message: found.subject },
          {
            from: "Grace Mbeki",
            message: "Thanks - I can reproduce this and I'm looking into it now.",
          },
        ],
      };
    },
    assignTicket: (input) => ({
      ok: true,
      ticketId: text(input, "ticketId"),
      assignee: text(input, "assignee"),
    }),
    escalateTicket: (input) => ({
      ok: true,
      ticketId: text(input, "ticketId"),
      escalatedTo: "Sam Adeyemi",
    }),
  },

  atlas: {
    searchDatasets: (input) => ({
      datasets: DATASETS.filter((d) =>
        has(`${d.dataset} ${d.owner} ${d.description}`, text(input, "query")),
      ),
    }),
    getDatasetSchema: (input) => {
      const found = DATASETS.find((d) => d.dataset === text(input, "dataset"));
      if (found === undefined) return { found: false };
      return {
        dataset: found.dataset,
        refreshedAt: ago(3 * 60 * 60 * 1000),
        columns: [
          { name: "day", type: "date" },
          { name: "account_id", type: "string" },
          { name: "value", type: "decimal" },
        ],
      };
    },
    runSavedQuery: (input) => ({
      queryId: text(input, "queryId"),
      ranAt: new Date().toISOString(),
      rows: ACCOUNTS.slice(0, 4).map((a) => ({
        account: a.name,
        weeklyActiveSeats: Math.round(40 + seed(a.accountId) * 260),
      })),
    }),
    refreshMaterialization: (input) => ({
      ok: true,
      dataset: text(input, "dataset"),
      estimatedMinutes: 6,
    }),
  },

  keyring: {
    listAccessRequests: (input) => ({
      requests: REQUESTS.filter((r) => has(r.system, text(input, "system"))).map((r) => ({
        requestId: r.requestId,
        who: r.who,
        system: r.system,
        access: r.access,
        askedOn: ago(r.age * DAY).slice(0, 10),
      })),
    }),
    getRequest: (input) => {
      const found = REQUESTS.find(
        (r) => r.requestId.toLowerCase() === text(input, "requestId").toLowerCase(),
      );
      return found === undefined
        ? { found: false }
        : { ...found, age: undefined, askedOn: ago(found.age * DAY).slice(0, 10) };
    },
    approveAccessRequest: (input) => ({
      ok: true,
      requestId: text(input, "requestId"),
      status: "approved",
    }),
    revokeAccess: (input) => ({
      ok: true,
      email: text(input, "email"),
      system: text(input, "system"),
      revokedAt: new Date().toISOString(),
    }),
  },

  "storefront-admin": {
    lookupCustomer: (input) => {
      const query = text(input, "query").toLowerCase();
      const found = ACCOUNTS.find(
        (a) =>
          a.accountId === query || query.endsWith(`@${a.domain}`) || has(a.name, query),
      );
      return found === undefined
        ? { found: false }
        : {
            accountId: found.accountId,
            name: found.name,
            domain: found.domain,
            plan: found.plan,
            customerSince: "2023-04-11",
          };
    },
    listSubscriptions: (input) => {
      const found = ACCOUNTS.find((a) => a.accountId === text(input, "accountId"));
      if (found === undefined) return { found: false };
      return {
        subscriptions: [
          {
            subscriptionId: `sub_${found.accountId.slice(4)}_main`,
            plan: found.plan,
            seats: Math.round(found.arr / 400),
            term: "annual",
            renewsOn: ahead(found.renews),
          },
        ],
      };
    },
    changePlan: (input) => ({
      ok: true,
      subscriptionId: text(input, "subscriptionId"),
      plan: text(input, "plan"),
      effective: ahead(0),
    }),
    deleteCustomerData: (input) => ({
      ok: true,
      accountId: text(input, "accountId"),
      status: "erasure scheduled",
      completesBy: ahead(30),
    }),
  },

  beacon: {
    listFlags: (input) => {
      const environment =
        text(input, "environment") === "staging" ? "staging" : "production";
      return {
        environment,
        flags: FLAGS.map((f) => ({
          flag: f.flag,
          description: f.description,
          rolloutPercent: f[environment],
        })),
      };
    },
    getFlag: (input) => {
      const found = FLAGS.find((f) => f.flag === text(input, "flag"));
      if (found === undefined) return { found: false };
      return {
        flag: found.flag,
        description: found.description,
        production: found.production,
        staging: found.staging,
        lastChanged: { by: "Kai Nakamura", on: ago(5 * DAY).slice(0, 10) },
      };
    },
    setFlagRollout: (input) => ({
      ok: true,
      flag: text(input, "flag"),
      rolloutPercent: input["percent"],
    }),
    killFlag: (input) => ({ ok: true, flag: text(input, "flag"), rolloutPercent: 0 }),
  },

  roster: {
    findPerson: (input) => ({
      people: PEOPLE.filter((p) =>
        has(`${p.name} ${p.title} ${p.team}`, text(input, "query")),
      ).map(({ name, title, team, email }) => ({ name, title, team, email })),
    }),
    getTeam: (input) => {
      const team = text(input, "team").toLowerCase();
      const members = PEOPLE.filter((p) => p.team === team);
      if (members.length === 0) return { found: false };
      return {
        team,
        manager: MANAGERS[team] ?? null,
        members: members.map(({ name, title, email }) => ({ name, title, email })),
      };
    },
    listOpenRoles: (input) => ({
      roles: ROLES.filter((r) => has(r.team, text(input, "team"))).map((r) => ({
        role: r.role,
        team: r.team,
        openSince: ago(r.openFor * DAY).slice(0, 10),
      })),
    }),
  },
};

/** The demo app's answer, or undefined when it has none for this. */
export function demoAnswer(
  appSlug: string,
  capabilityName: string,
  input: Input,
): unknown {
  const answer = ANSWERS[appSlug]?.[capabilityName];
  return answer === undefined ? undefined : JSON.parse(JSON.stringify(answer(input)));
}

/** Whether the demo app can answer this at all - which is what verifying it means. */
export function demoAnswers(appSlug: string, capabilityName: string): boolean {
  return ANSWERS[appSlug]?.[capabilityName] !== undefined;
}
