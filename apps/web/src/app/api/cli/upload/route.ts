import { NextResponse } from "next/server";
import { deploymentProvider } from "@cira/deploy";
import { MAX_FILE_BYTES } from "@cira/deploy";
import { userFromRequest } from "@/lib/cli-session";

export const maxDuration = 60;

/**
 * Accept one source file, addressed by its hash.
 *
 * Content-addressed, so a redeploy only sends what changed, and the hash is
 * supplied by the client purely as an address: the provider verifies it, and a
 * wrong one simply fails to match rather than corrupting anything.
 */
export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const sha = request.headers.get("x-cira-sha");
  if (sha === null || !/^[0-9a-f]{40}$/.test(sha)) {
    return NextResponse.json(
      { error: "Missing or malformed file hash" },
      { status: 400 },
    );
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "That file is too large" }, { status: 413 });
  }

  try {
    await deploymentProvider().uploadFile(sha, body.byteLength, body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
