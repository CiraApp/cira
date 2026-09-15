"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A hairline of accent across the top of the window while a page is on its
 * way.
 *
 * Most navigations in Cira are prefetched and land in a frame, so this is
 * deliberately late: it waits a beat before showing anything, which means the
 * fast case - nearly every case - stays completely still. A progress bar that
 * flashes on every click is noise, and noise on every click is what makes an
 * app feel busy rather than quick.
 *
 * It listens for the click rather than for a router event, because the App
 * Router exposes no navigation events. That is enough: an internal link click
 * is precisely the thing that is about to change the page.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "running" | "finishing">("idle");
  const timers = useRef<number[]>([]);

  const clear = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Anything the browser handles itself is not a route change.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (anchor === null || anchor === undefined) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (href === null || href.startsWith("#")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname) return;

      clear();
      timers.current.push(window.setTimeout(() => setState("running"), 180));
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      clear();
    };
  }, []);

  // The page arrived: run the bar out to the end and take it away.
  useEffect(() => {
    clear();
    setState((current) => (current === "idle" ? "idle" : "finishing"));
    timers.current.push(window.setTimeout(() => setState("idle"), 320));
    return clear;
  }, [pathname]);

  if (state === "idle") return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]"
    >
      <div
        className={`h-full bg-accent shadow-[0_0_12px_1px_color-mix(in_oklab,var(--color-accent)_70%,transparent)] ${
          state === "finishing"
            ? "w-full opacity-0 transition-[width,opacity] duration-300 ease-[var(--ease-settle)]"
            : "animate-[crawl_9s_cubic-bezier(0.06,0.9,0.2,1)_forwards]"
        }`}
      />
    </div>
  );
}
