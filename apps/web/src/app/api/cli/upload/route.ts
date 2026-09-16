import { NextResponse } from "next/server";

/**
 * The route source files used to be uploaded through, one at a time.
 *
 * Source goes straight from the CLI into storage now and never passes through
 * Cira, so there is nothing here to do. It exists only so that a CLI installed
 * before that change fails with a sentence someone can act on, instead of the
 * bare 404 it would otherwise get midway through a deploy.
 *
 * It can go once nobody is running a CLI older than 0.2.0.
 */
export function POST() {
  return NextResponse.json(
    { error: "This version of the Cira CLI is too old. Run: npm i -g @cira-app/cli" },
    { status: 410 },
  );
}
