"use server";

import { listVisibleApps } from "@/lib/authz";

export interface PaletteApp {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  image: string | null;
  status: string;
}

/**
 * The launcher's index of a space.
 *
 * Fetched when the palette is first opened rather than shipped with every
 * page: the shell renders on screens where nobody will ever press the
 * shortcut, and an index nobody asked for is a query nobody needed.
 *
 * It goes through the same permission path as the gallery, so the palette can
 * never surface an app its list would have hidden.
 */
export async function spaceIndex(spaceSlug: string): Promise<PaletteApp[]> {
  const apps = await listVisibleApps(spaceSlug);

  return apps.map((app) => ({
    id: app.id,
    name: app.name,
    slug: app.slug,
    description: app.description,
    icon: app.icon,
    image: app.image,
    status: app.status,
  }));
}
