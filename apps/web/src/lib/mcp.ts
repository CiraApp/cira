import "server-only";

import type { User } from "@cira/core";
import {
  getCapabilityForUser,
  NO_SUCH_CAPABILITY,
  listCapabilitiesForUser,
  searchCapabilitiesForUser,
  type CapabilityWithApp,
} from "@/lib/capabilities";
import { invokeCapability } from "@/lib/invoke-capability";

/**
 * Cira's agent-facing surface.
 *
 * MCP is an adapter, not Cira's internal standard. Three stable tools rather
 * than one per capability: a company's shelf changes every time somebody
 * deploys, and an agent should not have to re-read a tool list to notice.
 * Search, describe, invoke - the same three verbs however many capabilities
 * exist behind them.
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
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export interface ToolOutcome {
  /** Rendered as the tool result an agent reads. */
  content: string;
  isError: boolean;
}

export async function runTool(
  user: User,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  switch (name) {
    case "search_capabilities":
      return searchTool(user, args);
    case "describe_capability":
      return describeTool(user, args);
    case "invoke_capability":
      return invokeTool(user, args);
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
): Promise<ToolOutcome> {
  const id = typeof args["capabilityId"] === "string" ? args["capabilityId"] : "";
  const input = args["input"];

  const result = await invokeCapability({ user, capabilityId: id, input });

  if (!result.ok) return { content: result.error, isError: true };

  return { content: JSON.stringify(result.data, null, 2), isError: false };
}

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
  };
}
