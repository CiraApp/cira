"use client";

import { useId, useRef } from "react";
import { hexToHsl, hslToHex, type Hsl } from "@/lib/theme";

/**
 * A colour wheel that belongs to this interface.
 *
 * The browser's own `<input type="color">` opens an operating-system window in
 * the corner of the screen: a different typeface, a different set of corners,
 * and it covers the very thing you are trying to judge. This is the same
 * choice made in place, over the live interface, so you are always looking at
 * the result rather than at a dialog about the result.
 *
 * Angle is hue and distance from the middle is saturation, which is what makes
 * a wheel legible without a legend: related colours sit next to each other and
 * the grey is where it belongs, in the centre. Lightness is the one axis a
 * wheel cannot show, so it gets a track underneath.
 */
export function ColorWheel({
  value,
  onPreview,
  onCommit,
}: {
  /** `#rrggbb`. */
  value: string;
  /** Fires continuously while dragging, so the page follows the pointer. */
  onPreview: (hex: string) => void;
  /** Fires when the gesture ends, so only settled values are remembered. */
  onCommit: (hex: string) => void;
}) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const hsl = hexToHsl(value);

  // A fully dark or fully light colour has no meaningful hue, and reading one
  // off it would send the knob to red every time the lightness track reached
  // an end. Keeping the last angle lets someone slide back out again.
  const lastHue = useRef(hsl.h);
  if (hsl.s > 0.02 && hsl.l > 0.02 && hsl.l < 0.98) lastHue.current = hsl.h;
  const hue = hsl.s > 0.02 ? hsl.h : lastHue.current;

  const fromPoint = (clientX: number, clientY: number): Hsl | null => {
    const box = wheelRef.current?.getBoundingClientRect();
    if (box === undefined) return null;

    const radius = box.width / 2;
    const dx = clientX - (box.left + radius);
    const dy = clientY - (box.top + radius);

    // Measured clockwise from the top, which is the direction a conic gradient
    // paints, so the angle under the pointer is the hue beneath it.
    let h = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (h < 0) h += 360;

    return { h, s: Math.min(1, Math.hypot(dx, dy) / radius), l: hsl.l };
  };

  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    const next = fromPoint(event.clientX, event.clientY);
    if (next !== null) onPreview(hslToHex(next));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2;
    const moves: Record<string, Hsl> = {
      ArrowLeft: { ...hsl, h: hue - step },
      ArrowRight: { ...hsl, h: hue + step },
      ArrowUp: { ...hsl, h: hue, s: Math.min(1, hsl.s + step / 100) },
      ArrowDown: { ...hsl, h: hue, s: Math.max(0, hsl.s - step / 100) },
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onCommit(hslToHex(next));
  };

  const knobX = 50 + Math.sin((hue * Math.PI) / 180) * hsl.s * 50;
  const knobY = 50 - Math.cos((hue * Math.PI) / 180) * hsl.s * 50;

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={wheelRef}
        // A slider, so that where the knob sits is read out as it moves; the
        // wheel is two sliders in one, and the text says both.
        role="slider"
        aria-roledescription="colour wheel"
        aria-label="Hue and saturation"
        aria-describedby={hintId}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(hue) % 360}
        aria-valuetext={`${hsl.s < 0.05 ? "grey" : hueName(hue)}, ${Math.round(hsl.s * 100)} percent saturation`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          track(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) track(event);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          const next = fromPoint(event.clientX, event.clientY);
          if (next !== null) onCommit(hslToHex(next));
        }}
        style={{
          // The white centre is listed first because the first background in
          // the list is the one painted on top.
          backgroundImage:
            "radial-gradient(circle closest-side, #fff, transparent), conic-gradient(red, #ff0, #0f0, #0ff, #00f, #f0f, red)",
        }}
        className="relative mx-auto h-[172px] w-[172px] cursor-crosshair touch-none rounded-full ring-1 ring-line-strong outline-none select-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {/* Lightness, shown on the wheel rather than only on the track, so the
            colours under the knob are the colours you are actually choosing. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: hsl.l > 0.5 ? "#fff" : "#000",
            opacity: hsl.l > 0.5 ? (hsl.l - 0.5) * 2 : 1 - hsl.l * 2,
          }}
        />

        <span
          aria-hidden="true"
          style={{ left: `${knobX}%`, top: `${knobY}%`, background: value }}
          className="pointer-events-none absolute h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.45),0_2px_6px_rgb(0_0_0/0.4)]"
        />
      </div>

      <span id={hintId} className="sr-only">
        Left and right arrows change the hue, up and down the saturation. Hold Shift for
        bigger steps.
      </span>

      <label className="flex items-center gap-2.5">
        <span className="w-[46px] shrink-0 text-[12px] text-ink-muted">Light</span>
        <input
          name="lightness"
          type="range"
          min={0}
          max={100}
          value={Math.round(hsl.l * 100)}
          aria-label="Lightness"
          aria-valuetext={`${Math.round(hsl.l * 100)} percent`}
          onChange={(event) =>
            onPreview(hslToHex({ h: hue, s: hsl.s, l: Number(event.target.value) / 100 }))
          }
          onPointerUp={(event) =>
            onCommit(
              hslToHex({ h: hue, s: hsl.s, l: Number(event.currentTarget.value) / 100 }),
            )
          }
          onKeyUp={(event) =>
            onCommit(
              hslToHex({ h: hue, s: hsl.s, l: Number(event.currentTarget.value) / 100 }),
            )
          }
          className="track min-w-0 flex-1"
          style={{
            // The track is the decision: black to this colour at full strength
            // to white, so the position of the handle is self-explanatory.
            ["--track" as string]: `linear-gradient(to right, #000, ${hslToHex({ h: hue, s: hsl.s, l: 0.5 })}, #fff)`,
          }}
        />
      </label>
    </div>
  );
}

/** A hue said as a word, which is how people think of one. */
function hueName(degrees: number): string {
  const names = [
    [15, "red"],
    [45, "orange"],
    [70, "yellow"],
    [160, "green"],
    [200, "cyan"],
    [255, "blue"],
    [290, "purple"],
    [335, "pink"],
    [360, "red"],
  ] as const;
  const h = ((degrees % 360) + 360) % 360;
  return names.find(([limit]) => h < limit)?.[1] ?? "red";
}
