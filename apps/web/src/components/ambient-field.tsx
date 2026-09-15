"use client";

import { useEffect, useRef } from "react";

/**
 * The quiet motion behind the product.
 *
 * A slow drift of points with hairlines between near neighbours: enough to
 * give the ground depth and suggest a system doing something, never enough to
 * pull the eye off an app card. Canvas rather than DOM nodes, so it costs one
 * composited layer instead of hundreds of elements the browser has to lay out.
 *
 * It stops when nobody can see it (hidden tab), when the window is small
 * enough that it would only be noise, and entirely when the viewer has asked
 * for less motion. It is decoration: the page is complete without it.
 */
export function AmbientField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let running = true;

    // Density scales with area rather than being fixed, so a wide monitor is
    // not sparse and a laptop is not soup.
    type Point = { x: number; y: number; vx: number; vy: number; r: number };
    let points: Point[] = [];

    const readInk = () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-accent")
        .trim() || "#5b85ff";

    let accent = readInk();
    const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.min(130, Math.round((width * height) / 13000));
      points = Array.from({ length: target }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.17,
        vy: (Math.random() - 0.5) * 0.17,
        r: Math.random() * 1.4 + 0.6,
      }));
      accent = readInk();
    };

    const draw = () => {
      if (!running) return;

      context.clearRect(0, 0, width, height);

      const dark = isDark();
      const dotAlpha = dark ? 0.85 : 0.5;
      const lineAlpha = dark ? 0.3 : 0.16;
      const reach = 150;

      for (const p of points) {
        p.x += p.vx;
        p.y += p.vy;

        // Wrap rather than bounce: bouncing reads as a boundary, and there
        // shouldn't appear to be one.
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;
      }

      context.strokeStyle = accent;
      context.lineWidth = 0.6;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i] as Point;
        for (let j = i + 1; j < points.length; j += 1) {
          const b = points[j] as Point;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distance = Math.hypot(dx, dy);
          if (distance > reach) continue;

          context.globalAlpha = (1 - distance / reach) * lineAlpha;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }

      context.fillStyle = accent;
      for (const p of points) {
        context.globalAlpha = dotAlpha;
        context.beginPath();
        context.arc(p.x, p.y, p.r, 0, Math.PI * 2);
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
    const onResize = () => {
      build();
    };
    const onScheme = () => {
      accent = readInk();
    };

    build();
    frame = requestAnimationFrame(draw);

    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    // The accent differs per theme, so the field has to be told when it moves.
    const themeWatcher = new MutationObserver(onScheme);
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      stop();
      window.removeEventListener("resize", onResize);
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
