import "server-only";

import { appLabel } from "@cira/core";
import { browserAccessConfigured } from "@/lib/proxy-config";

/**
 * Where a person is sent to open an app.
 *
 * Cira's own domain, not the app's. The app has its own hostname and knows
 * nothing about who is signed in here, so opening one always begins with Cira
 * saying who this is; `/enter` is where that happens.
 *
 * Null when there is nowhere to send them - either apps are not configured to
 * be served at all, or this app's slugs cannot make a legal hostname.
 */
export function appOpenPath(address: {
  appSlug: string;
  spaceSlug: string;
}): string | null {
  if (!browserAccessConfigured()) return null;
  const label = appLabel(address);
  return label === null ? null : `/enter/${label}`;
}
