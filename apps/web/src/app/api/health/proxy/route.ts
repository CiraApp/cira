import { proxyConfig } from "@/lib/proxy-config";
import { checkProxy, healthResponse } from "@/lib/health";

/** Whether the app proxy, which every deployed app is opened through, is up. */
export async function GET() {
  return healthResponse(await checkProxy(proxyConfig().appsDomain));
}
