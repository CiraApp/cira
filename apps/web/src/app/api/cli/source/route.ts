import { NextResponse } from "next/server";
import { z } from "zod";
import { newId } from "@cira/core";
import { MAX_BUNDLE_BYTES, sourceStore } from "@cira/deploy";
import { userFromRequest } from "@/lib/cli-session";

export const maxDuration = 60;

/**
 * Open somewhere for the CLI to put a project's source.
 *
 * This route never sees the source. It authorises an upload and returns where
 * to send it; the bytes go from the CLI straight into Google's bucket. That is
 * deliberate rather than an optimisation - Cira runs on Vercel, whose request
 * bodies are capped well below the size of a real project, so source that
 * passed through here could never be larger than a few megabytes.
 *
 * The returned URL is a credential: it grants writing one object, once, for a
 * limited time. It goes to the caller who asked for it and is not logged.
 */

const body = z.object({
  /**
   * The archive's exact length. Google is told it up front and enforces it, so
   * a client cannot authorise a small upload and then send something else.
   */
  size: z
    .number()
    .int()
    .positive()
    .max(MAX_BUNDLE_BYTES, "That folder is too large to deploy."),
});

export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Bad request" },
      { status: 400 },
    );
  }

  // Named by Cira, not by the caller. The deploy that follows rebuilds the
  // object's path from this id and the caller's own, so an id cannot be used
  // to reach an upload belonging to someone else.
  const sourceId = newId("source");

  try {
    const ticket = await sourceStore().createUpload({
      userId: user.id,
      sourceId,
      size: parsed.data.size,
    });

    return NextResponse.json({
      sourceId: ticket.sourceId,
      uploadUrl: ticket.uploadUrl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start the upload." },
      { status: 502 },
    );
  }
}
