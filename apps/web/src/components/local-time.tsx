"use client";

import { useSyncExternalStore } from "react";

/**
 * A time in the reader's own zone, or relative to their clock.
 *
 * The server knows neither: formatted there it came out in UTC and changed in
 * the browser, which React reports as a hydration mismatch and a person sees
 * as a time that jumps. So until the page has hydrated it is a placeholder,
 * and then it is right.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

function noSubscription(): () => void {
  return () => undefined;
}

export function LocalTime({
  at,
  as = "when",
}: {
  at: Date | string;
  /** A date and time, or how far ahead it is ("in 5 min"). */
  as?: "when" | "ahead";
}) {
  const hydrated = useHydrated();
  const date = typeof at === "string" ? new Date(at) : at;
  return (
    <time dateTime={date.toISOString()}>
      {!hydrated ? "-" : as === "ahead" ? ahead(date) : when(date)}
    </time>
  );
}

function when(at: Date): string {
  return at.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ahead(at: Date): string {
  const minutes = Math.round((at.getTime() - Date.now()) / 60_000);
  if (minutes < 1) return "in under a minute";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}
