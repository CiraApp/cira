import { db } from "@cira/db";
import { checkDatabase, healthResponse } from "@/lib/health";

/** Whether cira.dev is up: the app is serving, and its database answers. */
export async function GET() {
  return healthResponse(await checkDatabase(db()));
}
