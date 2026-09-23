import { db } from "@cira/db";
import {
  checkDatabase,
  checkDrill,
  checkProxy,
  combine,
  healthResponse,
} from "@/lib/health";
import { proxyConfig } from "@/lib/proxy-config";

/**
 * Whether Cira is up: the app is serving, its database answers, and the app
 * proxy every deployed app is opened through is running. Checked every minute
 * by one uptime monitor, which is why the proxy is asked here too.
 */
export async function GET() {
  return healthResponse(
    combine(
      await Promise.all([
        checkDatabase(db()),
        checkProxy(proxyConfig().appsDomain).catch(() => ({
          ok: false as const,
          failing: "app proxy",
        })),
        checkDrill(process.env["CIRA_HEALTH_DRILL_UNTIL"]),
      ]),
    ),
  );
}
