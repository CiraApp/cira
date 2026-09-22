import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AnthropicSdk from "@anthropic-ai/sdk";

/**
 * What a deploy is told when analysis does not go as planned. Never the model
 * provider's own words - a status, a JSON body and a request id about Cira's
 * account - and never nothing when a large app's answer runs long.
 */

const replies: Array<() => Promise<unknown>> = [];
const systems: string[] = [];

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof AnthropicSdk>();
  class Fake {
    static APIError = actual.APIError;
    messages = {
      stream: (request: { system: string }) => {
        systems.push(request.system);
        const next = replies.shift() ?? (() => Promise.reject(new Error("no reply")));
        return { finalMessage: next };
      },
    };
  }
  return { ...actual, default: Fake };
});

const apiError = async (status: number, message: string) => {
  const { APIError } = await import("@anthropic-ai/sdk");
  return new APIError(status, { error: { message } }, message, new Headers());
};

const answer =
  (stop: string, parsed: unknown = null) =>
  () =>
    Promise.resolve({ stop_reason: stop, parsed_output: parsed });

beforeEach(() => {
  replies.length = 0;
  systems.length = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
});

describe("analyzeCapabilities", () => {
  it("says the service is unavailable, never the provider's own words", async () => {
    const { analyzeCapabilities } = await import("./capability-analyzer");
    const refused = await apiError(
      400,
      '400 {"type":"error","error":{"message":"Your credit balance is too low"},"request_id":"req_1"}',
    );
    replies.push(() => Promise.reject(refused));
    const result = await analyzeCapabilities("app.get('/x')", { appName: "A" });
    expect(result.ok).toBe(false);
    const said = result.ok ? "" : result.error;
    expect(said).toContain("unavailable right now");
    expect(said).not.toMatch(/credit|request_id|\{/);
  });

  it("says a busy service is busy", async () => {
    const { analyzeCapabilities } = await import("./capability-analyzer");
    const busy = await apiError(529, "overloaded");
    replies.push(() => Promise.reject(busy));
    const result = await analyzeCapabilities("x", { appName: "A" });
    expect(!result.ok && result.error).toContain("busy");
  });

  it("asks again for the most used operations when the full list runs past the limit", async () => {
    const { analyzeCapabilities } = await import("./capability-analyzer");
    replies.push(
      answer("max_tokens"),
      answer("end_turn", { summary: "Orders.", capabilities: [] }),
    );
    const result = await analyzeCapabilities("x", { appName: "A" });
    expect(result).toEqual({ ok: true, summary: "Orders.", capabilities: [] });
    expect(systems).toHaveLength(2);
    expect(systems[1]).toContain("This app is large");
  });

  it("says so when even the shorter list does not fit", async () => {
    const { analyzeCapabilities } = await import("./capability-analyzer");
    replies.push(answer("max_tokens"), answer("max_tokens"));
    const result = await analyzeCapabilities("x", { appName: "A" });
    expect(!result.ok && result.error).toContain(
      "more operations than Cira can describe",
    );
  });
});
