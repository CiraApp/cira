import { NextResponse } from "next/server";
import { watchEverything } from "@/lib/watch";

/**
 * The watcher's clock: Vercel Cron calls this every five minutes (see
 * vercel.json), with `CRON_SECRET` as its bearer token. Anything else is
 * turned away, since each call wakes every app Cira runs.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env["CRON_SECRET"]?.trim();
  if (secret === undefined || secret === "") {
    return NextResponse.json(
      { error: "The watcher is not configured." },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }

  // The report is the response, so each run's findings are in Vercel's
  // record of the request.
  const report = await watchEverything();
  return NextResponse.json(report);
}
