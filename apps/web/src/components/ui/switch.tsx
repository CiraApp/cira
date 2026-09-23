"use client";

/**
 * On or off, for one setting.
 *
 * On is green, off is a plain track with the same white knob. Off has to read
 * as "can be switched on", not as locked: a grey knob on a grey track is how
 * a disabled control looks, and was mistaken for one. Only a switch that
 * really cannot be used is faded.
 *
 * Its name is what it controls ("Keep Ledger warm"), never what pressing it
 * would do: the state is `aria-checked`, and a name that flipped with it read
 * as "Turn off worker, switch, on".
 *
 * `busy` is for while a change is being saved. It ignores presses but keeps
 * focus, where `disabled` would drop a keyboard user onto the page behind the
 * very control they were using.
 */
export function Switch({
  on,
  label,
  onChange,
  disabled = false,
  busy = false,
  title,
  describedBy,
  className = "",
}: {
  on: boolean;
  label: string;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  title?: string | undefined;
  /** The id of text that explains the setting, read after its name. */
  describedBy?: string | undefined;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-describedby={describedBy}
      aria-disabled={busy || undefined}
      title={title}
      disabled={disabled}
      onClick={() => {
        if (!busy) onChange(!on);
      }}
      className={`group relative h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-progress ${
        on
          ? "bg-live-fill"
          : "bg-line-strong shadow-[inset_0_0_0_1px_var(--color-field-border)] enabled:hover:bg-ink-subtle/60"
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-[left] duration-200 ease-[var(--ease-spring)] ${
          on ? "left-[18px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}
