import { NextResponse } from "next/server";
import { z } from "zod";
import { cliAuthRequests, db } from "@cira/db";
import { newId } from "@cira/core";
import { loginExpiry, newDeviceCode, newUserCode } from "@/lib/cli-auth";
import { hashToken } from "@/lib/token-hash";

const body = z.object({
  label: z.string().trim().min(1).max(80).optional(),
});

/** Begin a `cira login`. Deliberately open: it hands out no access by itself. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  const label = parsed.success ? (parsed.data.label ?? "CLI") : "CLI";

  const deviceCode = newDeviceCode();
  const userCode = newUserCode();

  await db()
    .insert(cliAuthRequests)
    .values({
      id: newId("cliLogin"),
      // The CLI gets the code; the table keeps only enough to recognise it.
      deviceCodeHash: hashToken(deviceCode),
      userCode,
      label,
      expiresAt: loginExpiry(),
    });

  return NextResponse.json({
    deviceCode,
    userCode,
    // Relative: the CLI joins it to whichever host it was pointed at.
    verifyPath: "/cli",
    expiresInSeconds: 600,
    intervalSeconds: 2,
  });
}
