"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PRESETS, accentContrast, normalizeHex, type Theme } from "@/lib/theme";
import { Portal } from "@/components/ui/portal";
import { useTheme } from "./theme-provider";

/**
 * Where the light/dark switch used to be.
 *
 * A switch offered two answers to a question that has an infinite number of
 * them. This offers the same two as presets and then gets out of the way: any
 * base, any accent, applied to the live interface as you drag rather than
 * behind a preview swatch, because the only useful preview of an interface is
 * the interface.
 */
export function ThemePicker() {
  const { theme, effective, setTheme, reset, preview } = useTheme();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  // The panel is portalled out of the header, which applies a backdrop filter
  // and would otherwise become its containing block, so its position has to be
  // measured rather than inherited.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const box = buttonRef.current?.getBoundingClientRect();
      if (box === undefined) return;
      setAnchor({ top: box.bottom + 8, right: window.innerWidth - box.right });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (boxRef.current?.contains(target) === true) return;
      if (buttonRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A preview left running after the panel closes would be a theme nobody
  // chose and nothing would ever clear.
  useEffect(() => {
    if (!open) preview(null);
  }, [open, preview]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Change colours"
        className="flex h-[30px] w-[30px] items-center justify-center rounded-[var(--radius-edge)] transition-[background-color,transform] duration-150 hover:bg-sunken active:scale-90"
      >
        {/* The button is the swatch: the two colours in the shape the
            interface is actually using them, ground behind accent. */}
        <span
          aria-hidden="true"
          className="relative h-4 w-4 overflow-hidden rounded-[2px] border border-line-strong bg-base"
        >
          <span className="absolute inset-x-0 bottom-0 h-1/2 bg-accent" />
        </span>
      </button>

      {open && anchor !== null ? (
        <Portal>
          <div
            ref={boxRef}
            role="dialog"
            aria-label="Interface colours"
            style={{ top: anchor.top, right: anchor.right }}
            className="enter-scale fixed z-50 w-[288px] rounded-[var(--radius-edge)] border border-line-strong bg-raised p-3 shadow-[var(--shadow-panel)]"
          >
            <p className="eyebrow px-0.5">Presets</p>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  title={preset.name}
                  aria-label={preset.name}
                  onMouseEnter={() => preview(preset)}
                  onMouseLeave={() => preview(null)}
                  onFocus={() => preview(preset)}
                  onBlur={() => preview(null)}
                  onClick={() => setTheme({ base: preset.base, accent: preset.accent })}
                  data-current={
                    theme?.base === preset.base && theme.accent === preset.accent
                      ? "true"
                      : undefined
                  }
                  className="relative h-8 w-full overflow-hidden rounded-[2px] border border-line transition-transform duration-200 ease-[var(--ease-spring)] hover:scale-110 data-[current]:border-accent"
                  style={{ background: preset.base }}
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-[10px]"
                    style={{ background: preset.accent }}
                  />
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-2.5">
              <ColorRow
                label="Base"
                value={effective.base}
                onChange={(base) => setTheme({ ...effective, base })}
                onPreview={(base) => preview({ ...effective, base })}
              />
              <ColorRow
                label="Accent"
                value={effective.accent}
                onChange={(accent) => setTheme({ ...effective, accent })}
                onPreview={(accent) => preview({ ...effective, accent })}
              />
            </div>

            <Legibility theme={effective} />

            <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
              <span className="text-[11px] text-ink-subtle">
                {theme === null ? "Following your system" : "Saved in this browser"}
              </span>
              <button
                type="button"
                onClick={reset}
                disabled={theme === null}
                className="btn btn-ghost px-2 py-1 text-[11.5px]"
              >
                Reset
              </button>
            </div>
          </div>
        </Portal>
      ) : null}
    </>
  );
}

/**
 * One colour: a native well for choosing and a hex field for typing.
 *
 * `onPreview` fires continuously while the well is dragged and `onChange` only
 * when it settles, so the page follows the pointer without writing a hundred
 * values to storage on the way.
 */
function ColorRow({
  label,
  value,
  onChange,
  onPreview,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  onPreview: (hex: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value);

  // The field follows the theme when it changes from anywhere else - a preset,
  // the other row, a reset - but must not fight what is being typed into it.
  useEffect(() => setText(value), [value]);

  const commit = (raw: string) => {
    const hex = normalizeHex(raw);
    if (hex === null) setText(value);
    else onChange(hex);
  };

  return (
    <div className="flex items-center gap-2.5">
      <label htmlFor={id} className="w-[46px] shrink-0 text-[12px] text-ink-muted">
        {label}
      </label>

      <input
        id={id}
        type="color"
        value={value}
        onInput={(event) => onPreview(event.currentTarget.value)}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-7 w-9 shrink-0 cursor-pointer rounded-[2px] border border-line bg-transparent p-0.5"
      />

      <input
        type="text"
        value={text}
        spellCheck={false}
        autoComplete="off"
        aria-label={`${label} colour, hex`}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(event.currentTarget.value);
        }}
        className="field min-w-0 flex-1 px-2 py-1 font-mono text-[11.5px] uppercase"
      />
    </div>
  );
}

/**
 * Whether the accent can still be read on the base.
 *
 * Shown rather than enforced: someone choosing their own colours is allowed to
 * choose badly, but they should be able to see that they have. 3:1 is the WCAG
 * floor for an interface component.
 */
function Legibility({ theme }: { theme: Theme }) {
  const ratio = accentContrast(theme);
  if (ratio >= 3) return null;

  return (
    <p className="enter-fade mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-pending">
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="mt-[1px] h-3 w-3 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M8 1.8 15 14H1L8 1.8ZM8 6.4v3.2M8 11.8v.1" />
      </svg>
      <span>
        This accent is hard to see on this ground ({ratio.toFixed(1)}:1). Links and the
        primary action will be difficult to pick out.
      </span>
    </p>
  );
}
