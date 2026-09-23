"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The quiet motion behind the product.
 *
 * A slow drift of points with hairlines between near neighbours, laid out in
 * depth: a far point is small, dim and barely moves, a near one is brighter
 * and travels. That is what stops it reading as a flat screensaver.
 *
 * It answers the pointer. Points inside its reach ease away from it and the
 * links around it brighten, so the ground acknowledges the hand without ever
 * chasing it - the displacement is small and it relaxes back the moment the
 * pointer leaves. The field also drifts against the scroll, at a fraction of a
 * pixel per pixel, which is the cheapest depth cue there is.
 *
 * Canvas rather than DOM nodes, so it costs one composited layer instead of
 * hundreds of elements the browser has to lay out. It stops when nobody can
 * see it (hidden tab) and never starts when the viewer has asked for less
 * motion. It is decoration: the page is complete without it.
 */
export function AmbientField() {
  const ref = useRef<HTMLCanvasElement>(null);
  // Still until the preference is known, and again the moment it is set:
  // asking for less motion in the middle of a visit stops the field then, not
  // at the next page load.
  const [still, setStill] = useState(true);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const hear = () => setStill(reduced.matches);
    hear();
    reduced.addEventListener("change", hear);
    return () => reduced.removeEventListener("change", hear);
  }, []);

  useEffect(() => {
    if (still) return;
    const canvas = ref.current;
    if (canvas === null) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let running = true;

    /**
     * `z` is depth, 0 far to 1 near, and it drives size, brightness, speed and
     * how much of the parallax and the pointer a point feels. One number, four
     * jobs: that is what makes the layers hold together.
     */
    type Point = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      z: number;
      /** Current offset away from the pointer, eased rather than jumped. */
      ox: number;
      oy: number;
    };
    let points: Point[] = [];

    // Pointer and scroll are both read as targets and chased, so a flicked
    // mouse or a thrown scroll arrives as a glide rather than a jump.
    const pointer = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, active: false };
    let parallax = 0;
    let parallaxTarget = 0;

    const REACH = 150;
    const POINTER_REACH = 190;

    const readAccent = () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-accent")
        .trim() || "#5b85ff";

    let accent = readAccent();
    const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Density scales with area rather than being fixed, so a wide monitor is
      // not sparse and a laptop is not soup.
      const target = Math.min(130, Math.round((width * height) / 13000));
      points = Array.from({ length: target }, () => {
        const z = Math.random();
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * (0.06 + z * 0.22),
          vy: (Math.random() - 0.5) * (0.06 + z * 0.22),
          z,
          ox: 0,
          oy: 0,
        };
      });
      accent = readAccent();
    };

    const draw = () => {
      if (!running) return;

      context.clearRect(0, 0, width, height);

      const dark = isDark();
      const dotAlpha = dark ? 0.85 : 0.5;
      const lineAlpha = dark ? 0.3 : 0.16;

      pointer.x += (pointer.tx - pointer.x) * 0.12;
      pointer.y += (pointer.ty - pointer.y) * 0.12;
      parallax += (parallaxTarget - parallax) * 0.08;

      for (const p of points) {
        p.x += p.vx;
        p.y += p.vy;

        // Wrap rather than bounce: bouncing reads as a boundary, and there
        // shouldn't appear to be one.
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        // Ease toward the displacement the pointer is asking for, and toward
        // zero when it is asking for nothing. Same line does both.
        let wantX = 0;
        let wantY = 0;
        if (pointer.active) {
          const dx = p.x + p.ox - pointer.x;
          const dy = p.y + p.oy - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance < POINTER_REACH && distance > 0.01) {
            const push = (1 - distance / POINTER_REACH) ** 2 * 26 * (0.4 + p.z);
            wantX = (dx / distance) * push;
            wantY = (dy / distance) * push;
          }
        }
        p.ox += (wantX - p.ox) * 0.08;
        p.oy += (wantY - p.oy) * 0.08;
      }

      // Drawn positions, computed once: depth parallax, pointer displacement
      // and the scroll offset all land here rather than in the physics above.
      const px = points.map((p) => p.x + p.ox);
      const py = points.map((p) => p.y + p.oy - parallax * (0.2 + p.z * 0.8));

      context.strokeStyle = accent;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i] as Point;
        const ax = px[i] as number;
        const ay = py[i] as number;

        for (let j = i + 1; j < points.length; j += 1) {
          const b = points[j] as Point;
          const bx = px[j] as number;
          const by = py[j] as number;

          const dx = ax - bx;
          const dy = ay - by;
          const distance = Math.hypot(dx, dy);
          if (distance > REACH) continue;

          const depth = (a.z + b.z) / 2;

          // A link the pointer is standing on top of is brighter and heavier,
          // so the hand appears to be lighting the mesh rather than moving it.
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          const near = pointer.active
            ? Math.max(0, 1 - Math.hypot(mx - pointer.x, my - pointer.y) / POINTER_REACH)
            : 0;

          context.globalAlpha =
            (1 - distance / REACH) * lineAlpha * (0.45 + depth * 0.55) * (1 + near * 2.2);
          context.lineWidth = 0.5 + near * 0.55;
          context.beginPath();
          context.moveTo(ax, ay);
          context.lineTo(bx, by);
          context.stroke();
        }
      }

      context.fillStyle = accent;
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i] as Point;
        const x = px[i] as number;
        const y = py[i] as number;
        const near = pointer.active
          ? Math.max(0, 1 - Math.hypot(x - pointer.x, y - pointer.y) / POINTER_REACH)
          : 0;

        context.globalAlpha = dotAlpha * (0.3 + p.z * 0.7) * (1 + near * 0.9);
        context.beginPath();
        context.arc(x, y, 0.5 + p.z * 1.5 + near * 0.6, 0, Math.PI * 2);
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
    const onResize = () => build();
    const onScroll = () => {
      parallaxTarget = window.scrollY * 0.06;
    };
    const onPointerMove = (event: PointerEvent) => {
      pointer.tx = event.clientX;
      pointer.ty = event.clientY;
      if (!pointer.active) {
        // First sighting: place it rather than glide in from the corner.
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.active = true;
      }
    };
    const onPointerLeave = () => {
      pointer.active = false;
    };
    const onScheme = () => {
      accent = readAccent();
    };

    build();
    frame = requestAnimationFrame(draw);

    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);
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
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      themeWatcher.disconnect();
    };
  }, [still]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
