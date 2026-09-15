"use client";

import { useEffect, useRef } from "react";

/**
 * Fine motes drifting through the atmosphere.
 *
 * Deliberately just points. An earlier version drew hairlines between near
 * neighbours, which reads as a network graph — the wrong identity entirely for
 * something meant to suggest air. Without the lines the same motion reads as
 * dust caught in light, which is what it should be.
 *
 * Canvas rather than DOM, so it costs one composited layer instead of hundreds
 * of laid-out nodes. It stops when nobody can see it and never starts when the
 * viewer has asked for less motion; the page is complete without it.
 */
export function AmbientField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let running = true;

    type Mote = { x: number; y: number; vx: number; vy: number; r: number; a: number };
    let motes: Mote[] = [];

    const readGold = () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--gold-metal")
        .trim() || "#c9a961";

    let gold = readGold();
    const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.min(90, Math.round((width * height) / 19000));
      motes = Array.from({ length: target }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        // Biased upward and to the right: a consistent direction reads as air
        // moving, where random directions read as noise.
        vx: Math.random() * 0.1 + 0.02,
        vy: -(Math.random() * 0.08 + 0.015),
        r: Math.random() * 1.1 + 0.35,
        a: Math.random() * 0.5 + 0.2,
      }));
      gold = readGold();
    };

    const draw = () => {
      if (!running) return;

      context.clearRect(0, 0, width, height);
      const ceiling = isDark() ? 0.75 : 0.42;
      context.fillStyle = gold;

      for (const m of motes) {
        m.x += m.vx;
        m.y += m.vy;

        if (m.x > width + 8) m.x = -8;
        if (m.y < -8) m.y = height + 8;

        context.globalAlpha = m.a * ceiling;
        context.beginPath();
        context.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        context.fill();
      }

      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (running) return;
      running = true;
      frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    build();
    frame = requestAnimationFrame(draw);

    window.addEventListener("resize", build, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    // The gold differs per theme, so the field has to be told when it moves.
    const themeWatcher = new MutationObserver(() => {
      gold = readGold();
    });
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      stop();
      window.removeEventListener("resize", build);
      document.removeEventListener("visibilitychange", onVisibility);
      themeWatcher.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
