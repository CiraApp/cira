import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  ASK_LIMITS,
  runAsk,
  type AskCapability,
  type AskHost,
  type AskTurn,
} from "./agent";
import type { AskEvent, AskMessage } from "./protocol";

/**
 * The Ask Cira loop against a scripted model and an in-memory company.
 *
 * Nothing here needs the API or a database: the model is a list of turns it
 * will take, and the host records every tool call it is asked to make. That is
 * what lets the rules that matter be checked directly - above all that a write
 * never runs until a person says so.
 */

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

function turn(
  content: Block[],
  stop: Anthropic.Message["stop_reason"] = content.some((b) => b.type === "tool_use")
    ? "tool_use"
    : "end_turn",
): Anthropic.Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: content as Anthropic.ContentBlock[],
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    } as Anthropic.Usage,
  } as Anthropic.Message;
}

const say = (text: string) => turn([{ type: "text", text }]);
const call = (id: string, name: string, input: Record<string, unknown>) =>
  turn([{ type: "tool_use", id, name, input }]);

function scriptedModel(turns: Anthropic.Message[]) {
  const seen: AskTurn[] = [];
  return {
    seen,
    model: {
      async turn(request: AskTurn, onText: (delta: string) => void) {
        // A copy, because the loop keeps appending to the same array.
        seen.push({ ...request, messages: structuredClone(request.messages) });
        const next = turns.shift();
        if (next === undefined)
          throw new Error("The model was asked for more turns than scripted.");
        // In small pieces, the way the real stream arrives.
        for (const block of next.content) {
          if (block.type !== "text") continue;
          for (let i = 0; i < block.text.length; i += 40)
            onText(block.text.slice(i, i + 40));
        }
        return next;
      },
    },
  };
}

const revenue: AskCapability = {
  id: "cap_revenue",
  name: "getRevenue",
  description: "Total revenue between two dates.",
  risk: "read",
  enabled: true,
  reach: "callable",
  appId: "app_revenue",
  appName: "Revenue Dashboard",
  inputSchema: {
    type: "object",
    properties: { startDate: { type: "string" }, endDate: { type: "string" } },
    required: ["startDate", "endDate"],
  },
};

const refund: AskCapability = {
  id: "cap_refund",
  name: "createRefund",
  description: "Refund an invoice.",
  risk: "write",
  enabled: true,
  reach: "callable",
  appId: "app_billing",
  appName: "Billing",
  inputSchema: {
    type: "object",
    properties: { invoiceId: { type: "string" }, amount: { type: "number" } },
    required: ["invoiceId", "amount"],
  },
};

function company(
  capabilities: AskCapability[],
  answers: Record<string, string> = {},
): AskHost & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async run(name, args) {
      calls.push({ name, args });
      if (name === "search_capabilities") {
        return {
          content: JSON.stringify({
            capabilities: capabilities.map((c) => ({ capabilityId: c.id })),
          }),
          isError: false,
        };
      }
      const id = String(args["capabilityId"]);
      if (name === "describe_capability")
        return { content: `{"capabilityId":"${id}"}`, isError: false };
      return { content: answers[id] ?? `{"ok":true}`, isError: false };
    },
    async capability(id) {
      return capabilities.find((c) => c.id === id) ?? null;
    },
  };
}

async function ask(args: {
  turns: Anthropic.Message[];
  host: AskHost;
  history?: AskMessage[];
  input: { question: string } | { decision: { toolUseId: string; run: boolean } };
}) {
  const { model, seen } = scriptedModel(args.turns);
  const events: AskEvent[] = [];
  let clock = 0;
  const usage = await runAsk({
    model,
    host: args.host,
    system: "system",
    tools: [],
    history: args.history ?? [],
    input: args.input,
    emit: (event) => events.push(event),
    now: () => (clock += 400),
  });
  const done = events.find((e) => e.type === "done");
  return { events, seen, usage, history: done?.type === "done" ? done.messages : null };
}

describe("runAsk", () => {
  it("answers a question by searching, describing and invoking", async () => {
    const host = company([revenue], { cap_revenue: '{"total":482913.55}' });

    const { events, usage, history } = await ask({
      host,
      input: { question: "How much revenue last month?" },
      turns: [
        call("t1", "search_capabilities", { query: "revenue" }),
        call("t2", "describe_capability", { capabilityId: "cap_revenue" }),
        call("t3", "invoke_capability", {
          capabilityId: "cap_revenue",
          input: { startDate: "2026-08-01", endDate: "2026-08-31" },
        }),
        say("You made **$482,913.55** in August."),
      ],
    });

    expect(host.calls.map((c) => c.name)).toEqual([
      "search_capabilities",
      "describe_capability",
      "invoke_capability",
    ]);

    // Plain words, written by the server, settled in place.
    const settled = events.filter((e) => e.type === "step" && e.state !== "running");
    expect(settled.map((e) => (e.type === "step" ? e.label : ""))).toEqual([
      "Looked through your apps for “revenue”",
      "Read how to use Get revenue",
      "Get revenue for 2026-08-01, 2026-08-31",
    ]);
    const ran = settled.at(-1);
    expect(ran?.type === "step" && ran.data).toBe('{"total":482913.55}');
    expect(ran?.type === "step" && ran.app?.name).toBe("Revenue Dashboard");

    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => (e.type === "text" ? e.text : ""))
        .join(""),
    ).toBe("You made **$482,913.55** in August.");

    expect(usage.toolCalls).toBe(3);
    expect(usage.capabilityIds).toEqual(["cap_revenue"]);
    // The history the browser keeps: question, three calls with results, answer.
    expect(history).toHaveLength(8);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("checks on an app's background work, named after the app it found", async () => {
    const status = JSON.stringify({ app: "Weekly Reports", appId: "app_reports" });
    const host: AskHost = {
      run: (name, args) =>
        Promise.resolve(
          name === "app_status" && args["app"] === "the report"
            ? { content: status, isError: false }
            : {
                content: JSON.stringify({ apps: [{ app: "A" }, { app: "B" }] }),
                isError: false,
              },
        ),
      capability: () => Promise.reject(new Error("A status check is not a capability.")),
    };

    const { events } = await ask({
      host,
      input: { question: "Did the report run?" },
      turns: [
        call("t1", "app_status", { app: "reports app thing" }),
        call("t2", "app_status", { app: "the report" }),
        say("It ran at 09:00 UTC and succeeded."),
      ],
    });

    const steps = events.filter((e) => e.type === "step");
    expect(steps.map((e) => (e.type === "step" ? e.label : ""))).toEqual([
      "Checking on reports app thing",
      "Looked for “reports app thing” among your apps",
      "Checking on the report",
      "Checked on Weekly Reports",
    ]);
    const found = steps.at(-1);
    expect(found?.type === "step" && found.app).toEqual({
      id: "app_reports",
      name: "Weekly Reports",
    });
    expect(found?.type === "step" && found.data).toBe(status);
  });

  /**
   * The rule the whole feature rests on. A write is stopped by the server
   * from the capability's own record - not left to the model to remember to
   * ask - and the app is never called.
   */
  it("holds a write for a person instead of running it", async () => {
    const host = company([refund]);

    const { events, history } = await ask({
      host,
      input: { question: "Refund INV-2041, $120" },
      turns: [
        call("t1", "invoke_capability", {
          capabilityId: "cap_refund",
          input: { invoiceId: "INV-2041", amount: 120 },
        }),
      ],
    });

    expect(host.calls).toEqual([]);

    const confirm = events.find((e) => e.type === "confirm");
    expect(confirm).toEqual({
      type: "confirm",
      toolUseId: "t1",
      app: { id: "app_billing", name: "Billing" },
      action: "Create refund",
      description: "Refund an invoice.",
      input: { invoiceId: "INV-2041", amount: 120 },
    });

    // Stopped on the call, which is what a decision will answer.
    const last = history?.at(-1);
    expect(last?.role).toBe("assistant");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("runs the held write once the person says yes", async () => {
    const host = company([refund], { cap_refund: '{"refunded":true}' });
    const held = await ask({
      host,
      input: { question: "Refund INV-2041, $120" },
      turns: [
        call("t1", "invoke_capability", {
          capabilityId: "cap_refund",
          input: { invoiceId: "INV-2041", amount: 120 },
        }),
      ],
    });

    const { seen, events } = await ask({
      host,
      history: held.history ?? [],
      input: { decision: { toolUseId: "t1", run: true } },
      turns: [say("Done - INV-2041 was refunded $120.")],
    });

    expect(host.calls.map((c) => c.name)).toEqual(["invoke_capability"]);
    const result = seen[0]?.messages.at(-1);
    expect(JSON.stringify(result)).toContain('{\\"refunded\\":true}');
    expect(events.some((e) => e.type === "text")).toBe(true);
  });

  it("tells the model when the person says no, and runs nothing", async () => {
    const host = company([refund]);
    const held = await ask({
      host,
      input: { question: "Refund INV-2041, $120" },
      turns: [
        call("t1", "invoke_capability", {
          capabilityId: "cap_refund",
          input: { invoiceId: "INV-2041", amount: 120 },
        }),
      ],
    });

    const { seen } = await ask({
      host,
      history: held.history ?? [],
      input: { decision: { toolUseId: "t1", run: false } },
      turns: [say("Okay, I won't refund it.")],
    });

    expect(host.calls).toEqual([]);
    const answered = seen[0]?.messages.at(-1);
    expect(answered).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "The person chose not to run this.",
          is_error: true,
        },
      ],
    });
  });

  it("ignores an approval for anything but the call that is waiting", async () => {
    const host = company([refund]);
    const held = await ask({
      host,
      input: { question: "Refund INV-2041, $120" },
      turns: [
        call("t1", "invoke_capability", {
          capabilityId: "cap_refund",
          input: { invoiceId: "INV-2041", amount: 120 },
        }),
      ],
    });

    const { events, seen } = await ask({
      host,
      history: held.history ?? [],
      input: { decision: { toolUseId: "t_forged", run: true } },
      turns: [],
    });

    expect(host.calls).toEqual([]);
    expect(seen).toHaveLength(0);
    expect(events[0]).toEqual({
      type: "error",
      message: "That is no longer waiting for an answer.",
    });
  });

  it("closes off a waiting write when the person asks something else", async () => {
    const host = company([refund, revenue]);
    const held = await ask({
      host,
      input: { question: "Refund INV-2041, $120" },
      turns: [
        call("t1", "invoke_capability", {
          capabilityId: "cap_refund",
          input: { invoiceId: "INV-2041", amount: 120 },
        }),
      ],
    });

    const { seen } = await ask({
      host,
      history: held.history ?? [],
      input: { question: "Actually, what was revenue in July?" },
      turns: [say("Let me leave the refund.")],
    });

    expect(host.calls).toEqual([]);
    expect(seen[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "The person did not run this, and asked something else instead.",
          is_error: true,
        },
        { type: "text", text: "Actually, what was revenue in July?" },
      ],
    });
  });

  /**
   * Holding something that could never run would ask a person to approve
   * nothing. Each of these goes straight through to runTool, which says why.
   */
  it.each([
    ["switched off", { ...refund, enabled: false }],
    ["refused by the app", { ...refund, reach: "refused" as const }],
    ["not yet confirmed", { ...refund, reach: "pending" as const }],
  ])("does not hold a write that is %s", async (_why, capability) => {
    const host = company([capability]);
    const { events } = await ask({
      host,
      input: { question: "Refund INV-2041" },
      turns: [
        call("t1", "invoke_capability", {
          capabilityId: "cap_refund",
          input: { invoiceId: "INV-2041", amount: 120 },
        }),
        say("I can't do that."),
      ],
    });

    expect(events.some((e) => e.type === "confirm")).toBe(false);
    expect(host.calls.map((c) => c.name)).toEqual(["invoke_capability"]);
  });

  it("does not hold a write whose input its schema rejects", async () => {
    const host = company([refund]);
    const { events } = await ask({
      host,
      input: { question: "Refund INV-2041" },
      turns: [
        call("t1", "invoke_capability", {
          capabilityId: "cap_refund",
          input: { invoiceId: "INV-2041" },
        }),
        say("How much should I refund?"),
      ],
    });

    expect(events.some((e) => e.type === "confirm")).toBe(false);
  });

  it("marks a capability the app refuses as refused, not failed", async () => {
    const host = company([{ ...revenue, reach: "refused" }]);
    const { events } = await ask({
      host,
      input: { question: "Revenue?" },
      turns: [
        call("t1", "invoke_capability", { capabilityId: "cap_revenue", input: {} }),
        say("Revenue Dashboard asks everyone to sign in."),
      ],
    });

    const settled = events.find((e) => e.type === "step" && e.state !== "running");
    expect(settled).toMatchObject({
      state: "refused",
      label: "Revenue Dashboard asks everyone to sign in first",
    });
  });

  it("stops offering tools after the cap, so the model has to answer", async () => {
    const host = company([revenue]);
    const searches = Array.from({ length: ASK_LIMITS.toolCalls }, (_, i) =>
      call(`t${i}`, "search_capabilities", { query: `try ${i}` }),
    );

    const { seen, usage } = await ask({
      host,
      input: { question: "Something hard" },
      turns: [...searches, say("I couldn't find that.")],
    });

    expect(usage.toolCalls).toBe(ASK_LIMITS.toolCalls);
    expect(seen.at(-1)?.toolChoice).toEqual({ type: "none" });
    expect(seen[0]?.toolChoice).toEqual({
      type: "auto",
      disable_parallel_tool_use: true,
    });
  });

  it("shows the model a trimmed answer and the person the whole one", async () => {
    const huge = JSON.stringify({ rows: "x".repeat(ASK_LIMITS.resultChars * 2) });
    const host = company([revenue], { cap_revenue: huge });

    const { events, seen } = await ask({
      host,
      input: { question: "Everything" },
      turns: [
        call("t1", "invoke_capability", {
          capabilityId: "cap_revenue",
          input: { startDate: "a", endDate: "b" },
        }),
        say("Here it is, in part."),
      ],
    });

    const step = events.find((e) => e.type === "step" && e.state === "done");
    expect(step?.type === "step" && step.data).toBe(huge);

    const toModel = JSON.stringify(seen[1]?.messages.at(-1));
    expect(toModel.length).toBeLessThan(huge.length);
    expect(toModel).toContain("Trimmed");
  });

  /**
   * Found by running the real model: told not to, it still announces what it
   * is about to do before calling a tool, and shown, those announcements ran
   * straight into the answer - "...for August (last month):The Ledger shows".
   */
  it("keeps the model's preamble out of the answer", async () => {
    const host = company([revenue], { cap_revenue: '{"total":1}' });
    const preamble = (
      id: string,
      name: string,
      input: Record<string, unknown>,
      words: string,
    ) =>
      turn([
        { type: "text", text: words },
        { type: "tool_use", id, name, input },
      ]);

    const { events, history } = await ask({
      host,
      input: { question: "Revenue last month?" },
      turns: [
        preamble(
          "t1",
          "search_capabilities",
          { query: "revenue" },
          "Let me look for that.",
        ),
        preamble(
          "t2",
          "invoke_capability",
          { capabilityId: "cap_revenue", input: { startDate: "a", endDate: "b" } },
          "Perfect. Now I'll fetch it.",
        ),
        say("You made **$1** in August."),
      ],
    });

    const shown = events
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.text : ""))
      .join("");
    expect(shown).toBe("You made **$1** in August.");
    // Still in the history: it is what the model said, and it reads its own turns.
    expect(JSON.stringify(history)).toContain("Let me look for that.");
  });

  it("streams a long answer as it is written rather than holding all of it", async () => {
    const long = "Here is everything. ".repeat(40);
    const { events } = await ask({
      host: company([]),
      input: { question: "Tell me all" },
      turns: [say(long)],
    });

    const pieces = events.filter((e) => e.type === "text");
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((e) => (e.type === "text" ? e.text : "")).join("")).toBe(long);
  });

  it("never runs a call from a turn that was refused", async () => {
    const host = company([revenue]);
    const { events } = await ask({
      host,
      input: { question: "…" },
      turns: [
        turn(
          [
            {
              type: "tool_use",
              id: "t1",
              name: "invoke_capability",
              input: { capabilityId: "cap_revenue" },
            },
          ],
          "refusal",
        ),
      ],
    });

    expect(host.calls).toEqual([]);
    expect(events).toContainEqual({ type: "text", text: "I can't help with that one." });
  });

  it("never runs a call cut off by the token limit", async () => {
    const host = company([revenue]);
    const { events } = await ask({
      host,
      input: { question: "…" },
      turns: [
        turn(
          [
            {
              type: "tool_use",
              id: "t1",
              name: "invoke_capability",
              input: { capabilityId: "cap_revenue" },
            },
          ],
          "max_tokens",
        ),
      ],
    });

    expect(host.calls).toEqual([]);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });
});
