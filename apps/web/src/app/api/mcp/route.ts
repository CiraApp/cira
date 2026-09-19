import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/cli-session";
import { TOOLS, runTool } from "@/lib/mcp";

export const maxDuration = 60;

/**
 * Cira's MCP endpoint.
 *
 * Streamable HTTP, stateless: every request carries its own credential and
 * nothing is remembered between them. An MCP server with four fixed tools and
 * no subscriptions needs no session, and not having one means an agent can
 * reconnect, retry or run several calls at once without coordinating.
 *
 * The protocol is handled here rather than through the SDK because the SDK's
 * transport expects Node's request and response objects, which a route handler
 * does not have, and because what is actually needed is three JSON-RPC methods.
 * Keeping it to those three is what the spec means by a thin adapter; all the
 * behaviour lives in lib/mcp and the capability service beneath it.
 *
 * Agents authenticate with a Cira CLI token: the same credential `cira login`
 * already issues, so an employee connecting an agent creates nothing new.
 */

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    // MCP clients look for this header to know how to authenticate.
    return NextResponse.json(
      { error: "Not signed in. Connect with a Cira CLI token." },
      { status: 401, headers: { "www-authenticate": 'Bearer realm="cira"' } },
    );
  }

  const payload: unknown = await request.json().catch(() => null);
  if (!isRequest(payload)) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  // A notification has no id and takes no reply, which is how `initialized`
  // arrives. Answering one is a protocol error, so it gets an empty 202.
  const isNotification = payload.id === undefined || payload.id === null;
  const id = payload.id ?? null;

  switch (payload.method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "cira", version: "0.1.0" },
        instructions:
          "Cira exposes the internal software this employee is allowed to use. " +
          "Search for a capability, describe it to learn its input, then invoke it. " +
          "To see whether an app's workers and scheduled runs are working, check its status.",
      });

    case "notifications/initialized":
      return new Response(null, { status: 202 });

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, { tools: TOOLS });

    case "tools/call": {
      const params = payload.params ?? {};
      const name = params["name"];
      const args = params["arguments"];

      if (typeof name !== "string") {
        return fail(id, -32602, "A tool name is required.");
      }

      const outcome = await runTool(
        user,
        name,
        typeof args === "object" && args !== null && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {},
        { via: "mcp", origin: new URL(request.url).origin },
      );

      // A tool that refused is a result, not a transport failure: the agent
      // needs to read why and try something else.
      return reply(id, {
        content: [{ type: "text", text: outcome.content }],
        isError: outcome.isError,
      });
    }

    default:
      if (isNotification) return new Response(null, { status: 202 });
      return fail(id, -32601, `Cira's MCP server does not implement ${payload.method}.`);
  }
}

/**
 * Some clients open a stream before posting anything. Cira never pushes, so
 * the honest answer is that this endpoint does not offer one.
 */
export function GET() {
  return new Response("This MCP endpoint is request/response only.", { status: 405 });
}

function isRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate["jsonrpc"] === "2.0" && typeof candidate["method"] === "string";
}

function reply(id: string | number | null, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

function fail(id: string | number | null, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
}
