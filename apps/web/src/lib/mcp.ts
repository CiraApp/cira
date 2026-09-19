import "server-only";

import type { User } from "@cira/core";
import {
  getCapabilityForUser,
  NO_SUCH_CAPABILITY,
  listCapabilitiesForUser,
  searchCapabilitiesForUser,
  type CapabilityWithApp,
} from "@/lib/capabilities";
import { appStatusForUser } from "@/lib/app-status";
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
      "permission and validates the input before the app is called.",
    inputSchema: {
      type: "object",
      properties: {
        capabilityId: { type: "string" },
        input: {
          type: "object",
          description: "Must match the capability's inputSchema.",
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
}

export async function runTool(
  user: User,
  name: string,
  args: Record<string, unknown>,
  { via, origin }: ToolContext,
): Promise<ToolOutcome> {
  switch (name) {
    case "search_capabilities":
      return searchTool(user, args);
    case "describe_capability":
      return describeTool(user, args);
    case "invoke_capability":
      return invokeTool(user, args, via);
    case "app_status":
      return statusTool(user, args, origin);
    default:
      return { content: `Cira has no tool called ${name}.`, isError: true };
  }
}

async function searchTool(
  user: User,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const query = typeof args["query"] === "string" ? args["query"] : "";
  const limit = typeof args["limit"] === "number" ? args["limit"] : 20;

  const found =
    query.trim() === ""
      ? (await listCapabilitiesForUser(user)).slice(0, limit)
      : await searchCapabilitiesForUser(user, query, limit);

  if (found.length === 0) {
    return {
      content:
        "No capabilities match that, among the apps you can open. " +
        "Try different words, or search with an empty query to see everything.",
      isError: false,
    };
  }

  return {
    content: JSON.stringify({ capabilities: found.map(brief) }, null, 2),
    isError: false,
  };
}

async function describeTool(
  user: User,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const id = typeof args["capabilityId"] === "string" ? args["capabilityId"] : "";
  const capability = await getCapabilityForUser(user, id);

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
): Promise<ToolOutcome> {
  const id = typeof args["capabilityId"] === "string" ? args["capabilityId"] : "";
  const input = args["input"];

  const result = await invokeCapability({ user, capabilityId: id, input, via });

  if (!result.ok) return { content: result.error, isError: true };

  return { content: JSON.stringify(result.data, null, 2), isError: false };
}

async function statusTool(
  user: User,
  args: Record<string, unknown>,
  origin: string,
): Promise<ToolOutcome> {
  const query = typeof args["app"] === "string" ? args["app"] : "";
  const result = await appStatusForUser(user, query, origin);

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
const UNAVAILABLE: Record<"pending" | "refused", string> = {
  pending: "Cira has not confirmed this with the app yet. Try again shortly.",
  refused:
    "The app serves this route and will not let Cira call it, because it signs " +
    "its own users in and Cira is not one of them. No setting in Cira changes " +
    "that, so do not suggest enabling it.",
};

/**
 * What an agent needs to choose between capabilities.
 *
 * The risk grade is included deliberately: an agent deciding whether to ask
 * its human first should be able to see that something writes.
 */
function brief(capability: CapabilityWithApp) {
  return {
    capabilityId: capability.id,
    name: `${capability.appSlug}.${capability.name}`,
    description: capability.description,
    app: capability.appName,
    risk: capability.risk,
    enabled: capability.enabled,
    ...(capability.reach === "callable"
      ? {}
      : { unavailable: UNAVAILABLE[capability.reach] }),
  };
}
