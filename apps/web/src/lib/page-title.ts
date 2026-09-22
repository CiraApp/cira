import "server-only";

import type { Metadata } from "next";
import { requireAppAccess, requireSpaceMember } from "@/lib/authz";

/**
 * Titles for the pages inside a space, named after what they show - a
 * browser tab reading "Payroll · Acme" rather than one more "Cira" among
 * twelve. Looked up through the same checks as the page, so a title never
 * names a space or an app its reader could not open; for them it is neutral.
 */

export async function spaceTitle(spaceSlug: string, section?: string): Promise<Metadata> {
  try {
    const { space } = await requireSpaceMember(spaceSlug);
    return { title: section === undefined ? space.name : `${section} · ${space.name}` };
  } catch {
    return { title: "Not found" };
  }
}

export async function appTitle(
  spaceSlug: string,
  appSlug: string,
  section?: string,
): Promise<Metadata> {
  try {
    const { app } = await requireAppAccess(spaceSlug, appSlug);
    return { title: section === undefined ? app.name : `${section} · ${app.name}` };
  } catch {
    return { title: "Not found" };
  }
}
