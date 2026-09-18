import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MAX_QUESTION_CHARS, type AskMessage } from "./protocol";

/**
 * The conversation, as the browser hands it back.
 *
 * It is untrusted input like any other request body, so it is rebuilt from a
 * schema rather than passed through: three kinds of block, the three tools and
 * no others, and bounded sizes. What cannot be forged is enforced elsewhere -
 * every tool call is checked against the asking person's permissions when it
 * runs - so the job here is only to keep the shape honest and the request
 * small, and to drop anything the model API was never meant to receive from a
 * browser, such as a caching directive.
 */

/** Kept in step with TOOLS in lib/mcp.ts, and tested to be. */
export const ASK_TOOL_NAMES = [
  "search_capabilities",
  "describe_capability",
  "invoke_capability",
] as const;

/**
 * Far past any real conversation, well short of anything that would make one
 * request expensive to parse or to send on.
 */
const MAX_MESSAGES = 120;
const MAX_BLOCK_CHARS = 200_000;

const text = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(MAX_BLOCK_CHARS),
});

const toolUse = z.object({
  type: z.literal("tool_use"),
  id: z.string().min(1).max(200),
  name: z.enum(ASK_TOOL_NAMES),
  input: z.record(z.string(), z.unknown()),
});

const toolResult = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string().min(1).max(200),
  content: z.string().max(MAX_BLOCK_CHARS),
  // Always present after parsing, because the SDK's type says so under
  // `exactOptionalPropertyTypes` and a missing flag means the same thing.
  is_error: z.boolean().default(false),
});

const message = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("user"),
    content: z.union([
      z.string().min(1).max(MAX_BLOCK_CHARS),
      z.array(z.union([text, toolResult])).min(1),
    ]),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.array(z.union([text, toolUse])).min(1),
  }),
]);

const messages = z.array(message).max(MAX_MESSAGES);

export const askRequestSchema = z.union([
  z.object({
    messages,
    question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  }),
  z.object({
    messages,
    decision: z.object({ toolUseId: z.string().min(1).max(200), run: z.boolean() }),
  }),
]);

export type ParsedAskRequest = z.infer<typeof askRequestSchema>;

/**
 * The tool call the conversation is stopped on, if it is stopped on one.
 *
 * A conversation ends waiting when a write was held for a person's OK: the
 * last message is the model's request to run it, with no result after it. That
 * request is what a decision answers, and what a new question has to close
 * off first - the model API refuses a history with a tool call left open.
 */
export function pendingCall(
  history: readonly AskMessage[],
): Anthropic.ToolUseBlockParam | null {
  const last = history.at(-1);
  if (
    last === undefined ||
    last.role !== "assistant" ||
    typeof last.content === "string"
  ) {
    return null;
  }

  const uses = last.content.filter(
    (block): block is Anthropic.ToolUseBlockParam => block.type === "tool_use",
  );
  return uses.at(-1) ?? null;
}

/**
 * A model response, rewritten into the form it is sent back in.
 *
 * Only text and tool calls survive, and empty text is dropped: the API rejects
 * an empty text block in a history, and a turn that went straight to a tool
 * often begins with one.
 */
export function asHistory(
  content: readonly Anthropic.ContentBlock[],
): Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> {
  const kept: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
  for (const block of content) {
    if (block.type === "text" && block.text.trim() !== "") {
      kept.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      kept.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  return kept;
}
