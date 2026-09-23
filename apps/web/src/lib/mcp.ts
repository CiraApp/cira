import "server-only";

import { canRun, type User } from "@cira/core";
import {
  getCapabilityForUser,
  NO_SUCH_CAPABILITY,
  listCapabilitiesForUser,
  searchCapabilitiesForUser,
  type CapabilityWithApp,
} from "@/lib/capabilities";
import { appStatusForUser } from "@/lib/app-status";
import {
  APPROVAL_MINUTES,
  NOT_YET,
  consumeApproval,
  requestApproval,
} from "@/lib/approvals";
import { invokeCapability, type InvocationVia } from "@/lib/invoke-capability";

/**
 * Cira's agent-facing surface.
 *
 * MCP is an adapter, not Cira's internal standard. A few stable tools rather
 * than one per capability: a company's shelf changes every time somebody
 * deploys, and an agent should not have to re-read a tool list to notice.
 * Search, describe, invoke - the same three verbs however many capabilities
 * exist behind them - and one more for what apps do when nobody calls them:
 * how their workers and scheduled runs are doing.
 *
 * Every function here is a thin translation. Permission, validation, target
 * resolution and the call itself all live in the capability service, so an
 * agent reaches exactly the same rules a person does.
 */

export const TOOLS = [
  {
    name: "search_capabilities",
    description:
      "Find company capabilities the signed-in employee is allowed to use. " +
      "Search by what you want to do, e.g. 'company revenue' or 'customer lookup'. " +
      "Returns capability ids to pass to describe_capability and invoke_capability.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What you are looking for. Empty lists everything available.",
        },
        limit: { type: "integer", description: "Maximum results, default 20." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "describe_capability",
    description:
      "Get the full description of one capability, including the JSON schema " +
      "for its input. Read this before invoking anything.",
    inputSchema: {
      type: "object",
      properties: {
        capabilityId: { type: "string" },
      },
      required: ["capabilityId"],
      additionalProperties: false,
    },
  },
  {
    name: "invoke_capability",
    description:
      "Run a capability and return its result. Cira checks the employee's " +
      "permission and validates the input before the app is called. A " +
      "capability whose risk is 'write' changes data, so the first call does " +
      "not run it: it returns a link for the employee to approve exactly that " +
      "input in Cira. Show them the link, and once they say they have " +
      "approved, call again with the same input and the approvalId.",
    inputSchema: {
      type: "object",
      properties: {
        capabilityId: { type: "string" },
        input: {
          type: "object",
          description: "Must match the capability's inputSchema.",
        },
        approvalId: {
          type: "string",
          description:
            "For a write: the id Cira gave when it asked the employee to approve this call.",
        },
      },
      required: ["capabilityId"],
      additionalProperties: false,
    },
  },
  {
    name: "app_status",
    description:
      "Check on one of the company's apps: whether it is live, and how its " +
      "background work is doing - whether each worker is running, when each " +
      "scheduled run last ran, whether it succeeded, and when it runs next. " +
      "For the app's managers it also includes the commands and the latest log " +
      "lines. An empty app name lists the apps the employee can open.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description:
            "The app's name, as the employee said it or as a search result gave it.",
        },
      },
      required: ["app"],
      additionalProperties: false,
    },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export interface ToolOutcome {
  /** Rendered as the tool result an agent reads. */
  content: string;
  isError: boolean;
}

export interface ToolContext {
  /** Which surface is asking, for the record of who ran what. */
  via: InvocationVia;
  /** Cira's own origin, for links to its pages in what a tool returns. */
  origin: string;
  /**
   * The one space this surface was opened in, when it was. Ask Cira lives
   * inside a space and answers about that company only; a person in two used
   * to get the other one's apps mixed into its answers. MCP has no space and
   * reaches everything the person can open.
   */
  inSpace?: string | undefined;
}

export async function runTool(
  user: User,
  name: string,
  args: Record<string, unknown>,
  { via, origin, inSpace }: ToolContext,
): Promise<ToolOutcome> {
  switch (name) {
    case "search_capabilities":
      return searchTool(user, args, inSpace);
    case "describe_capability":
      return describeTool(user, args, inSpace);
    case "invoke_capability":
      return invokeTool(user, args, via, origin, inSpace);
    case "app_status":
      return statusTool(user, args, origin, inSpace);
    default:
      return { content: `Cira has no tool called ${name}.`, isError: true };
  }
}

async function searchTool(
  user: User,
  args: Record<string, unknown>,
  inSpace: string | undefined,
): Promise<ToolOutcome> {
  const query = typeof args["query"] === "string" ? args["query"] : "";
  const limit = typeof args["limit"] === "number" ? args["limit"] : 20;

  const found =
    query.trim() === ""
      ? (await listCapabilitiesForUser(user, inSpace)).slice(0, limit)
      : await searchCapabilitiesForUser(user, query, limit, inSpace);

  if (found.length === 0) {
    return {
      content:
        "No capabilities match that, among the apps you can open. " +
        "Try different words, or search with an empty query to see everything.",
      isError: false,
    };
  }

  const several = new Set(found.map((c) => c.spaceSlug)).size > 1;
  return {
    content: JSON.stringify(
      { capabilities: found.map((capability) => brief(capability, several)) },
      null,
      2,
    ),
    isError: false,
  };
}

async function describeTool(
  user: User,
  args: Record<string, unknown>,
  inSpace: string | undefined,
): Promise<ToolOutcome> {
  const id = typeof args["capabilityId"] === "string" ? args["capabilityId"] : "";
  const capability = await getCapabilityForUser(user, id, inSpace);

  if (capability === null) {
    return { content: NO_SUCH_CAPABILITY, isError: true };
  }

  return {
    content: JSON.stringify(
      {
        ...brief(capability),
        inputSchema: capability.inputSchema,
        outputSchema: capability.outputSchema,
        method: capability.target.method,
      },
      null,
      2,
    ),
    isError: false,
  };
}

async function invokeTool(
  user: User,
  args: Record<string, unknown>,
  via: InvocationVia,
  origin: string,
  inSpace: string | undefined,
): Promise<ToolOutcome> {
  const id = typeof args["capabilityId"] === "string" ? args["capabilityId"] : "";
  const input = args["input"];

  // Over MCP a write waits for its person, on a page in Cira. The assistant's
  // own client asking first is not enough: one "always allow" and it never
  // does. Ask Cira puts the same question to the person in its own window,
  // before it gets here, so only MCP needs the page.
  const capability = await getCapabilityForUser(user, id, inSpace);
  if (capability === null) return { content: NO_SUCH_CAPABILITY, isError: true };
  let spent: string | undefined;
  // A write that can run - confirmed, or turned on by a person although the
  // app could not confirm it - waits for its person the same way either way.
  if (
    via === "mcp" &&
    capability.risk === "write" &&
    capability.enabled &&
    canRun(capability.reach)
  ) {
    const given =
      input !== null && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const approvalId = typeof args["approvalId"] === "string" ? args["approvalId"] : null;

    if (approvalId === null) {
      const requested = await requestApproval({
        user,
        capabilityId: id,
        input: given,
        via,
      });
      return {
        content: JSON.stringify(
          {
            status: "needs_approval",
            message:
              `${brief(capability).name} changes data in ${capability.appName}, so it has not run. ` +
              `Ask ${user.name} to approve it at the link below. Nothing happens until they do. ` +
              `Then call invoke_capability again with the same input and this approvalId.`,
            approvalUrl: `${origin}/approve/${requested}`,
            approvalId: requested,
            expiresInMinutes: APPROVAL_MINUTES,
          },
          null,
          2,
        ),
        isError: false,
      };
    }

    const consumed = await consumeApproval({
      user,
      approvalId,
      capabilityId: id,
      input: given,
    });
    if (!consumed.ok) return { content: NOT_YET[consumed.reason], isError: true };
    spent = approvalId;
  }

  const result = await invokeCapability({
    user,
    capabilityId: id,
    input,
    via,
    approvalId: spent,
  });

  if (!result.ok) return { content: result.error, isError: true };

  return { content: forAnAgent(result.data), isError: false };
}

/**
 * The most of one result an agent is handed. An app can answer with up to a
 * megabyte, and all of it, pretty-printed, is a context window spent on one
 * call - or, through Ask Cira, a conversation the model can no longer hold.
 */
export const MAX_RESULT_CHARS = 100_000;

/** A result as an agent reads it: readable when small, whole or plainly cut. */
export function forAnAgent(data: unknown): string {
  const pretty = JSON.stringify(data, null, 2) ?? "null";
  if (pretty.length <= MAX_RESULT_CHARS) return pretty;
  const compact = JSON.stringify(data) ?? "null";
  if (compact.length <= MAX_RESULT_CHARS) return compact;
  return (
    `${compact.slice(0, MAX_RESULT_CHARS)}\n\n[Cut off: the app answered with ` +
    `${compact.length.toLocaleString("en-US")} characters, more than an agent is handed. ` +
    `Ask for less - a narrower range, a filter, or a page of it.]`
  );
}

async function statusTool(
  user: User,
  args: Record<string, unknown>,
  origin: string,
  inSpace: string | undefined,
): Promise<ToolOutcome> {
  const query = typeof args["app"] === "string" ? args["app"] : "";
  const result = await appStatusForUser(user, query, origin, inSpace);

  if (!result.ok) return { content: result.error, isError: true };

  return { content: JSON.stringify(result.data, null, 2), isError: false };
}

/**
 * Why an agent cannot run this, in the agent's own terms.
 *
 * `enabled: false` on its own reads as "ask an admin", and for a capability
 * the app itself refuses that is a wild goose chase: there is no switch. The
 * first agent to meet this spent its last turns proposing that someone enable
 * a login capability, which would not have helped either.
 */
const UNAVAILABLE: Record<"pending" | "refused" | "unconfirmed", string> = {
  pending: "Cira has not confirmed this with the app yet. Try again shortly.",
  refused:
    "The app serves this route and will not let Cira call it, because it signs " +
    "its own users in and Cira is not one of them. No setting in Cira changes " +
    "that, so do not suggest enabling it.",
  unconfirmed:
    "The app could not confirm this route without being called, so it is off " +
    "until someone who manages the app turns it on from the app's page in Cira.",
};

/**
 * What an agent needs to choose between capabilities.
 *
 * The risk grade is included deliberately: an agent deciding whether to ask
 * its human first should be able to see that something writes.
 */
function brief(capability: CapabilityWithApp, severalCompanies = false) {
  return {
    capabilityId: capability.id,
    // Someone in two companies can have a `crm` app in both. The company is
    // then part of the name, so an agent cannot pick the wrong one's.
    name: severalCompanies
      ? `${capability.spaceSlug}/${capability.appSlug}.${capability.name}`
      : `${capability.appSlug}.${capability.name}`,
    description: capability.description,
    app: capability.appName,
    company: capability.spaceSlug,
    risk: capability.risk,
    enabled: capability.enabled,
    // An unconfirmed one somebody turned on is available: they chose to let
    // its first real call settle it.
    ...(capability.reach === "callable" || capability.enabled
      ? {}
      : { unavailable: UNAVAILABLE[capability.reach] }),
  };
}
