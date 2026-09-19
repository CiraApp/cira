import { and, count, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { askUsage, db } from "@cira/db";
import { newId } from "@cira/core";
import { getCurrentUser } from "@/lib/identity";
import { getCapabilityForUser } from "@/lib/capabilities";
import { runTool } from "@/lib/mcp";
import { runAsk, type AskUsage } from "@/lib/ask/agent";
import { askRequestSchema } from "@/lib/ask/conversation";
import { anthropicModel, askTools, ASK_MODEL } from "@/lib/ask/model";
import { askSystemPrompt } from "@/lib/ask/prompt";
import type { AskEvent } from "@/lib/ask/protocol";

/**
 * Ask Cira's one endpoint.
 *
 * Signed-in people only: without a person there is no set of apps to ask, and
 * every tool call below runs as them. The answer comes back as server-sent
 * events on this one response - words as they are written, steps as they
 * start and finish - and closes with the whole conversation, which the
 * browser keeps. Nothing of what was said is written down here; see
 * `askUsage` for what is.
 */

/** Four model turns and an app call or three, with room for a slow app. */
export const maxDuration = 120;

/**
 * Questions per person per rolling day. Ordinary use never gets near it; it
 * exists so that a stuck script or a curious afternoon has a ceiling. Only
 * questions count - answering a confirmation never uses one up.
 */
const DAILY_QUESTIONS = 100;

/** Far above any real conversation, and cheap to refuse before parsing. */
const MAX_BODY_BYTES = 2_000_000;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (user === null) {
    return NextResponse.json({ error: "Sign in to ask Cira." }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "This conversation has grown too long. Start a new one." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "That request could not be read." },
      { status: 400 },
    );
  }

  const parsed = askRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "This conversation can't continue. Start a new one." },
      { status: 400 },
    );
  }

  if (process.env["ANTHROPIC_API_KEY"] === undefined) {
    return NextResponse.json(
      { error: "Ask Cira isn't set up on this Cira yet." },
      { status: 503 },
    );
  }

  const asking = "question" in parsed.data;
  const database = db();

  if (asking) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await database
      .select({ asked: count() })
      .from(askUsage)
      .where(
        and(
          eq(askUsage.userId, user.id),
          eq(askUsage.kind, "question"),
          gt(askUsage.createdAt, since),
        ),
      );

    if ((row?.asked ?? 0) >= DAILY_QUESTIONS) {
      return NextResponse.json(
        {
          error: `That's ${DAILY_QUESTIONS} questions today, which is as many as Cira answers in a day. It will be ready again tomorrow.`,
        },
        { status: 429 },
      );
    }
  }

  const encoder = new TextEncoder();
  const input =
    "question" in parsed.data
      ? { question: parsed.data.question }
      : { decision: parsed.data.decision };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: AskEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The browser has gone. The model call is cancelled through the
          // request's signal; anything still to say has nobody to hear it.
          open = false;
        }
      };

      let usage: AskUsage | null = null;
      try {
        usage = await runAsk({
          model: anthropicModel(request.signal),
          host: {
            run: (name, args) =>
              runTool(user, name, args, {
                via: "ask",
                origin: new URL(request.url).origin,
              }),
            capability: (id) => getCapabilityForUser(user, id),
          },
          system: askSystemPrompt(new Date()),
          tools: askTools(),
          history: parsed.data.messages,
          input,
          emit,
        });
      } catch (error) {
        // No `done` after this, deliberately: the browser keeps the
        // conversation it had and offers the question back, rather than
        // adopting a history with a question in it that was never answered.
        if (!request.signal.aborted) {
          console.error("Ask Cira failed", error);
          emit({
            type: "error",
            message: "Cira couldn't finish that answer. Try asking again.",
          });
        }
      } finally {
        await record(user.id, asking, usage);
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed by a departed browser.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      // Proxies that buffer would hold every word back until the end.
      "x-accel-buffering": "no",
    },
  });
}

/**
 * The usage record: who asked and what it cost, never what was said.
 *
 * Written even when the answer failed part-way, because the tokens were still
 * spent - and a failure to write it never fails the answer.
 */
async function record(userId: string, asking: boolean, usage: AskUsage | null) {
  try {
    await db()
      .insert(askUsage)
      .values({
        id: newId("askUsage"),
        userId,
        kind: asking ? "question" : "decision",
        model: ASK_MODEL,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cacheReadTokens ?? 0,
        toolCalls: usage?.toolCalls ?? 0,
        capabilityIds: usage?.capabilityIds ?? [],
      });
  } catch (error) {
    console.error("Could not record Ask Cira usage", error);
  }
}
