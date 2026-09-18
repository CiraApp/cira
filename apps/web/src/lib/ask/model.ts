import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { TOOLS } from "@/lib/mcp";
import type { AskModel } from "./agent";

/**
 * Which model answers.
 *
 * Haiku 4.5, because the job is finding one operation and calling it, not
 * reasoning at length - and because every question costs something and this is
 * a box everyone at a company is invited to type into. `CIRA_ASK_MODEL`
 * changes it without a deploy of code, the same way the analyzer's does.
 */
export const ASK_MODEL = process.env["CIRA_ASK_MODEL"] ?? "claude-haiku-4-5";

/**
 * Per model turn. Answers here are a few sentences or a short table; this is
 * room for that and a tool call, and a ceiling on what one runaway turn costs.
 */
const MAX_TOKENS = 2048;

/**
 * The three tools, exactly as agents see them over MCP.
 *
 * Derived rather than restated, so the chat and the MCP endpoint cannot drift
 * into describing the same tool two ways. Fine-grained input streaming is left
 * off on purpose: these inputs are a few words, there is nothing to gain from
 * streaming them, and leaving it off keeps the API's own validation of them.
 */
export function askTools(): Anthropic.Tool[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: structuredClone(
      tool.inputSchema,
    ) as unknown as Anthropic.Tool.InputSchema,
  }));
}

export function anthropicModel(signal: AbortSignal): AskModel {
  const client = new Anthropic();

  return {
    async turn(request, onText) {
      const stream = client.messages.stream(
        {
          model: ASK_MODEL,
          max_tokens: MAX_TOKENS,
          system: request.system,
          tools: request.tools,
          tool_choice: request.toolChoice,
          messages: request.messages,
          // Haiku 4.5 caches nothing shorter than 4,096 tokens, and the
          // instructions and tools alone are well under that - so this does
          // nothing on a first question. It earns its place on the later turns
          // of a question and on follow-ups, which resend the whole
          // conversation and are exactly where the tokens are.
          cache_control: { type: "ephemeral" },
        },
        { signal },
      );
      stream.on("text", onText);
      return stream.finalMessage();
    },
  };
}
