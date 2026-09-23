import type Anthropic from "@anthropic-ai/sdk";
import { canRun, type CapabilityReach, type JsonSchema } from "@cira/core";
import { validateInput } from "@/lib/json-schema";
import { asHistory, pendingCall } from "./conversation";
import type { AskApp, AskEvent, AskMessage, StepState } from "./protocol";
import { humanize, summarizeInput, trimForModel } from "./words";

/**
 * The Ask Cira loop: one question in, a streamed answer out.
 *
 * It owns no capability logic of its own. Every tool call goes through the
 * same `runTool` an agent reaches over MCP, so this can do exactly what the
 * person asking could do from Claude Code and nothing more - the checks on
 * access, on whether a capability is switched on and confirmed, and on its
 * input all run where they always run. What is new here is only the part a
 * browser needs: a model driving the tools, words streamed as they arrive,
 * steps described in plain language, and a stop before anything that writes.
 *
 * Written against two narrow interfaces rather than the SDK and the database
 * directly, so the rules that matter - the write gate, the call cap, trimming
 * - are tested without either.
 */

/** One model turn, streamed. The real one lives in `model.ts`. */
export interface AskModel {
  turn(request: AskTurn, onText: (delta: string) => void): Promise<Anthropic.Message>;
}

export interface AskTurn {
  system: string;
  messages: AskMessage[];
  tools: Anthropic.Tool[];
  toolChoice: Anthropic.ToolChoice;
}

/** The capability fields the loop reads. `CapabilityWithApp` satisfies it. */
export interface AskCapability {
  id: string;
  name: string;
  description: string;
  risk: "read" | "write";
  enabled: boolean;
  reach: CapabilityReach;
  appId: string;
  appName: string;
  inputSchema: JsonSchema;
}

/** Everything the loop does on the person's behalf, as that person. */
export interface AskHost {
  run(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }>;
  capability(id: string): Promise<AskCapability | null>;
}

export const ASK_LIMITS = {
  /**
   * Tool calls per question. A good answer takes three - search, describe,
   * invoke - and a follow-up fewer. Eight leaves room to recover from a wrong
   * first guess and stops a confused model looping on the person's bill.
   */
  toolCalls: 8,
  /** Characters of an app's answer the model reads. See `trimForModel`. */
  resultChars: 16_000,
  /**
   * How much of a turn is held back before it starts streaming. See
   * `Narration` below: preamble is a sentence or two, so anything past this is
   * an answer and can be shown as it is written.
   */
  holdChars: 240,
} as const;

export interface AskUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  toolCalls: number;
  capabilityIds: string[];
}

export type AskInput =
  { question: string } | { decision: { toolUseId: string; run: boolean } };

const DECLINED = "The person chose not to run this.";
const MOVED_ON = "The person did not run this, and asked something else instead.";

export async function runAsk(args: {
  model: AskModel;
  host: AskHost;
  system: string;
  tools: Anthropic.Tool[];
  history: AskMessage[];
  input: AskInput;
  emit: (event: AskEvent) => void;
  /** Milliseconds, for the time shown beside a step. Injected for tests. */
  now?: () => number;
}): Promise<AskUsage> {
  const { model, host, system, tools, emit } = args;
  const now = args.now ?? (() => Date.now());
  const messages: AskMessage[] = [...args.history];
  const usage: AskUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    toolCalls: 0,
    capabilityIds: [],
  };

  const pending = pendingCall(messages);

  if ("decision" in args.input) {
    const { toolUseId, run } = args.input.decision;

    // An approval is only ever for the call the conversation is actually
    // waiting on. Anything else - a stale tab, a second click, a forged id -
    // is answered with a sentence and changes nothing.
    if (pending === null || pending.id !== toolUseId) {
      emit({ type: "error", message: "That is no longer waiting for an answer." });
      emit({ type: "done", messages });
      return usage;
    }

    const result = run
      ? await perform(pending, host, emit, now, usage)
      : declined(pending.id, DECLINED);
    messages.push({ role: "user", content: [result] });
  } else {
    // A question typed while a write was waiting closes that write off first:
    // the API will not continue a history with a call left unanswered, and
    // moving on is itself an answer.
    messages.push({
      role: "user",
      content: [
        ...(pending === null ? [] : [declined(pending.id, MOVED_ON)]),
        { type: "text" as const, text: args.input.question },
      ],
    });
  }

  let wrote = false;

  /**
   * A turn's words, held until it is clear what they are.
   *
   * Told plainly not to, the model still announces what it is about to do -
   * "Let me look up the revenue..." - and then calls a tool in the same turn.
   * Shown, that preamble runs straight into the answer that follows it, and
   * the steps already say the same thing better. So a turn's text is held:
   * released if the turn ends as an answer, dropped if it ends in a tool call.
   * Held only up to `holdChars` - past that it is an answer being written, not
   * a preamble, and waiting for the end of it would be waiting for nothing.
   */
  const release = (text: string) => {
    // Two turns that both answered are two paragraphs, not one run-on line.
    emit({ type: "text", text: wrote ? `\n\n${text}` : text });
    wrote = true;
  };

  for (;;) {
    const capped = usage.toolCalls >= ASK_LIMITS.toolCalls;

    let held = "";
    let streaming = false;

    const message = await model.turn(
      {
        system,
        messages,
        tools,
        // One call per turn. Every question here is a short chain - search,
        // then describe, then invoke - and a turn with a single call is what
        // makes the write gate simple: there is never a half-run batch to
        // resume after someone says yes. At the cap, no tools at all, so the
        // model has to answer with what it already has.
        toolChoice: capped
          ? { type: "none" }
          : { type: "auto", disable_parallel_tool_use: true },
      },
      (delta) => {
        if (streaming) {
          emit({ type: "text", text: delta });
          return;
        }
        held += delta;
        if (held.length >= ASK_LIMITS.holdChars) {
          streaming = true;
          release(held);
          held = "";
        }
      },
    );

    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;
    usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;

    // A refusal can cut a tool call off part-way through its input, and a
    // call the model never finished is not one to act on - so only its words
    // are kept.
    const refused = message.stop_reason === "refusal";
    const content = asHistory(message.content).filter(
      (block) => !refused || block.type === "text",
    );
    const call = content.find(
      (block): block is Anthropic.ToolUseBlockParam => block.type === "tool_use",
    );

    // A call cut off by the token limit can parse as a valid, shorter input.
    // Running it would act on something the model never finished saying.
    if (call !== undefined && message.stop_reason === "max_tokens") {
      const said = content.filter((block) => block.type === "text");
      messages.push({
        role: "assistant",
        content: said.length > 0 ? said : [{ type: "text", text: "(stopped)" }],
      });
      emit({
        type: "error",
        message:
          "That ran longer than Cira allows for one answer. Try asking for less at once.",
      });
      break;
    }

    if (call === undefined && held.trim() !== "") release(held.trimStart());

    if (call === undefined) {
      if (content.length === 0) {
        // A refusal, or a turn that ended without a word. Say something
        // rather than leave an empty answer under the question.
        const fallback =
          message.stop_reason === "refusal"
            ? "I can't help with that one."
            : "I don't have an answer for that.";
        if (!wrote) emit({ type: "text", text: fallback });
        messages.push({ role: "assistant", content: [{ type: "text", text: fallback }] });
      } else {
        messages.push({ role: "assistant", content });
      }
      break;
    }

    messages.push({ role: "assistant", content });

    // The write gate. Decided here, by the server, from the capability's own
    // record - never left to the model's judgement about when to ask.
    const waiting = await holdForApproval(call, host);
    if (waiting !== null) {
      emit(waiting);
      emit({ type: "done", messages });
      return usage;
    }

    const result = await perform(call, host, emit, now, usage);
    messages.push({ role: "user", content: [result] });
  }

  emit({ type: "done", messages });
  return usage;
}

/**
 * A confirmation, if this call would change something and could actually run.
 *
 * Only a write that can run - confirmed with the app and switched on, or
 * turned on by a person although the app could not confirm it; `enabled` says
 * both - and given input its schema accepts is held. Anything short of that
 * goes through to `runTool`, which explains in words why it will not run -
 * holding it would ask a person to approve something that was never going to
 * happen.
 */
async function holdForApproval(
  call: Anthropic.ToolUseBlockParam,
  host: AskHost,
): Promise<AskEvent | null> {
  if (call.name !== "invoke_capability") return null;

  const input = call.input as Record<string, unknown>;
  const id = typeof input["capabilityId"] === "string" ? input["capabilityId"] : "";
  const capability = await host.capability(id);

  if (
    capability === null ||
    capability.risk !== "write" ||
    !capability.enabled ||
    !canRun(capability.reach)
  ) {
    return null;
  }

  const given = input["input"] ?? {};
  if (!validateInput(capability.inputSchema, given).ok) return null;

  return {
    type: "confirm",
    toolUseId: call.id,
    app: appOf(capability),
    action: humanize(capability.name),
    description: capability.description,
    input:
      typeof given === "object" && given !== null
        ? (given as Record<string, unknown>)
        : {},
  };
}

/** Run one call as the person, narrating it as two steps. */
async function perform(
  call: Anthropic.ToolUseBlockParam,
  host: AskHost,
  emit: (event: AskEvent) => void,
  now: () => number,
  usage: AskUsage,
): Promise<Anthropic.ToolResultBlockParam> {
  const args = call.input as Record<string, unknown>;
  const capabilityId =
    typeof args["capabilityId"] === "string" ? args["capabilityId"] : "";
  const capability =
    call.name === "describe_capability" || call.name === "invoke_capability"
      ? await host.capability(capabilityId)
      : null;

  const started = now();
  emit({
    type: "step",
    id: call.id,
    state: "running",
    ...runningLabel(call, capability),
  });

  const outcome = await host.run(call.name, args);
  usage.toolCalls += 1;
  if (call.name === "invoke_capability" && capability !== null) {
    usage.capabilityIds.push(capability.id);
  }

  emit({
    type: "step",
    id: call.id,
    ...settledLabel(call, capability, outcome, now() - started),
  });

  return {
    type: "tool_result",
    tool_use_id: call.id,
    content: trimForModel(outcome.content, ASK_LIMITS.resultChars),
    ...(outcome.isError ? { is_error: true } : {}),
  };
}

function declined(toolUseId: string, why: string): Anthropic.ToolResultBlockParam {
  return { type: "tool_result", tool_use_id: toolUseId, content: why, is_error: true };
}

function appOf(capability: AskCapability): AskApp {
  return { id: capability.appId, name: capability.appName };
}

function runningLabel(
  call: Anthropic.ToolUseBlockParam,
  capability: AskCapability | null,
): { label: string; app?: AskApp } {
  if (call.name === "search_capabilities") {
    const query = (call.input as Record<string, unknown>)["query"];
    const words = typeof query === "string" ? query.trim() : "";
    return {
      label:
        words === ""
          ? "Looking through your apps"
          : `Looking through your apps for “${words}”`,
    };
  }

  if (call.name === "app_status") {
    const app = (call.input as Record<string, unknown>)["app"];
    const named = typeof app === "string" ? app.trim() : "";
    return { label: named === "" ? "Looking through your apps" : `Checking on ${named}` };
  }

  if (capability === null) return { label: "Looking something up" };

  return call.name === "describe_capability"
    ? { label: `Reading how to use ${humanize(capability.name)}`, app: appOf(capability) }
    : { label: `Asking ${capability.appName}`, app: appOf(capability) };
}

function settledLabel(
  call: Anthropic.ToolUseBlockParam,
  capability: AskCapability | null,
  outcome: { content: string; isError: boolean },
  elapsed: number,
): { state: StepState; label: string; detail?: string; app?: AskApp; data?: string } {
  if (call.name === "search_capabilities") {
    const found = countFound(outcome.content);
    const { label } = runningLabel(call, capability);
    return {
      state: outcome.isError ? "failed" : "done",
      label: label.replace("Looking", "Looked"),
      detail: found === 0 ? "nothing found" : `${found} found`,
    };
  }

  if (call.name === "app_status") return statusSettled(call, outcome, elapsed);

  if (capability === null) {
    return { state: "failed", label: "Couldn't find that" };
  }

  const app = appOf(capability);

  if (call.name === "describe_capability") {
    return {
      state: outcome.isError ? "failed" : "done",
      label: `Read how to use ${humanize(capability.name)}`,
      app,
    };
  }

  if (capability.reach === "refused") {
    return {
      state: "refused",
      label: `${capability.appName} asks everyone to sign in first`,
      app,
    };
  }

  if (outcome.isError) {
    return { state: "failed", label: `${capability.appName} couldn't answer`, app };
  }

  const input = (call.input as Record<string, unknown>)["input"];
  const asked =
    typeof input === "object" && input !== null
      ? summarizeInput(input as Record<string, unknown>)
      : "";

  return {
    state: "done",
    label:
      asked === ""
        ? humanize(capability.name)
        : `${humanize(capability.name)} for ${asked}`,
    detail: `${(elapsed / 1000).toFixed(1)}s`,
    app,
    data: outcome.content,
  };
}

/**
 * A status check, named after the app it found. The app comes from what the
 * check returned rather than what was asked for, so "the report thing" is
 * shown as the app it turned out to be.
 */
function statusSettled(
  call: Anthropic.ToolUseBlockParam,
  outcome: { content: string; isError: boolean },
  elapsed: number,
): { state: StepState; label: string; detail?: string; app?: AskApp; data?: string } {
  if (outcome.isError) return { state: "failed", label: "Couldn't check on that" };

  let parsed: { app?: unknown; appId?: unknown; apps?: unknown } = {};
  try {
    parsed = JSON.parse(outcome.content) as typeof parsed;
  } catch {
    // Read as a list of nothing below.
  }

  if (typeof parsed.app === "string" && typeof parsed.appId === "string") {
    return {
      state: "done",
      label: `Checked on ${parsed.app}`,
      detail: `${(elapsed / 1000).toFixed(1)}s`,
      app: { id: parsed.appId, name: parsed.app },
      data: outcome.content,
    };
  }

  const found = Array.isArray(parsed.apps) ? parsed.apps.length : 0;
  // No single app: a list to choose from, because nothing was named or
  // because what was named did not settle on one.
  const asked = (call.input as Record<string, unknown>)["app"];
  const named = typeof asked === "string" ? asked.trim() : "";
  return {
    state: "done",
    label:
      named === "" ? "Looked through your apps" : `Looked for “${named}” among your apps`,
    detail: found === 1 ? "1 app" : `${found} apps`,
  };
}

/** How many capabilities a search returned, from its JSON or its sentence. */
function countFound(content: string): number {
  try {
    const parsed = JSON.parse(content) as { capabilities?: unknown };
    return Array.isArray(parsed.capabilities) ? parsed.capabilities.length : 0;
  } catch {
    return 0;
  }
}
