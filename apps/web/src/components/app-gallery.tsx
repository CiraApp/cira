"use client";

import { useMemo, useState } from "react";
import type { App } from "@cira/core";
import { AppCard } from "./app-card";

export function AppGallery({ apps, spaceSlug }: { apps: App[]; spaceSlug: string }) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return apps;

    return apps.filter((app) =>
      [app.name, app.description ?? ""].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [apps, query]);

  return (
    <div className="flex flex-col gap-6">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search apps..."
        aria-label="Search apps"
        className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-[15px] text-ink shadow-xs transition-shadow outline-none placeholder:text-ink-subtle focus:border-accent focus:ring-4 focus:ring-accent/12"
      />

      {matches.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-ink-muted">
          No apps match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4">
          {matches.map((app) => (
            <li key={app.id} className="min-w-0">
              <AppCard app={app} spaceSlug={spaceSlug} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
