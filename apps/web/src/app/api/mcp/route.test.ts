import { describe, expect, it, vi } from "vitest";
import { newId, type User } from "@cira/core";
import type * as CiraMcp from "@/lib/mcp";

/**
 * The MCP transport itself: authentication, JSON-RPC framing, and the three
 * tools being advertised. What the tools actually do is covered against a real
 * database and a real app in lib/capability-engine.test.ts; this is only the
 * envelope around them.
 */

const employee: User = {
  id: newId("user"),
  name: "Dana",
  email: "dana@demo.test",
  createdAt: new Date(),
};

let signedIn: User | null = employee;

vi.mock("@/lib/cli-session", () => ({
  userFromRequest: () => Promise.resolve(signedIn),
}));

vi.mock("@/lib/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraMcp>();
  return {
    ...actual,
    runTool: (_user: User, name: string, args: Record<string, unknown>) =>
      Promise.resolve(
        name === "search_capabilities"
          ? { content: JSON.stringify({ asked: args["query"] }), isError: false }
          : { content: `no tool ${name}`, isError: true },
      ),
  };
});

const { POST, GET } = await import("./route");

const rpc = (body: unknown) =>
  POST(
    new Request("http://cira.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer t" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("the MCP endpoint", () => {
  it("refuses an agent that has not signed in, and says how to", async () => {
    signedIn = null;
    const response = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    signedIn = employee;

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("introduces itself", async () => {
    const body = (await (
      await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" })
    ).json()) as {
      result: { serverInfo: { name: string }; capabilities: Record<string, unknown> };
    };
    expect(body.result.serverInfo.name).toBe("cira");
    expect(body.result.capabilities).toHaveProperty("tools");
  });

  it("advertises exactly the four stable tools", async () => {
    const body = (await (
      await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    ).json()) as {
      result: { tools: Array<{ name: string; inputSchema: unknown }> };
    };
    expect(body.result.tools.map((t) => t.name)).toEqual([
      "search_capabilities",
      "describe_capability",
      "invoke_capability",
      "app_status",
    ]);
    for (const tool of body.result.tools) {
      expect(tool.inputSchema).toHaveProperty("type", "object");
    }
  });

  it("passes a tool call through and returns its text", async () => {
    const body = (await (
      await rpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "search_capabilities", arguments: { query: "revenue" } },
      })
    ).json()) as { result: { content: Array<{ text: string }>; isError: boolean } };

    expect(body.result.isError).toBe(false);
    expect(JSON.parse(body.result.content[0]?.text ?? "")).toEqual({ asked: "revenue" });
  });

  it("reports a refused tool as a result, not as a transport failure", async () => {
    const response = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "nope", arguments: {} },
    });
    const body = (await response.json()) as { result: { isError: boolean } };

    // The agent has to be able to read why and try something else, which it
    // cannot do if the failure arrives as a protocol error.
    expect(response.status).toBe(200);
    expect(body.result.isError).toBe(true);
  });

  it("answers a notification with no body, because replying to one is an error", async () => {
    const response = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("rejects something that is not JSON-RPC at all", async () => {
    const body = (await (await rpc("not json")).json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("says so when asked for a method it does not implement", async () => {
    const body = (await (
      await rpc({ jsonrpc: "2.0", id: 5, method: "resources/list" })
    ).json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });

  it("does not pretend to offer a stream it never pushes to", () => {
    expect(GET().status).toBe(405);
  });
});
