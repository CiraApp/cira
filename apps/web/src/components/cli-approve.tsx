"use client";

import { useState, useTransition } from "react";
import { approveCliLogin } from "@/lib/cli-approve-actions";

export function CliApprove({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // A code that arrived already filled in came from a link, and a link is how
  // someone else would get a person to approve a login that is not theirs.
  // Typed by hand, it came from their own terminal.
  const [sure, setSure] = useState(initialCode === "");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await approveCliLogin(code);
      if (result.ok) setDone(result.label);
      else setError(result.error);
    });
  };

  if (done !== null) {
    return (
      <div className="enter-pop rounded-[var(--radius-edge)] border border-line bg-surface px-5 py-6 text-center">
        {/* Focused as it appears: the form, and the button that was pressed,
            are gone, and this is what there is to hear. */}
        <p
          ref={(element) => element?.focus()}
          tabIndex={-1}
          className="text-[15px] font-medium text-ink focus:outline-none"
        >
          You&rsquo;re connected
        </p>
        <p className="mt-1.5 text-[14px] text-ink-muted">
          Head back to your terminal. You can close this tab.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor="cli-code" className="text-[13px] font-medium text-ink">
        Enter the code shown in your terminal
      </label>

      <input
        id="cli-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder="XXXX-XXXX"
        className="field py-3 text-center font-mono text-[18px] tracking-[0.2em] uppercase placeholder:tracking-normal"
      />

      {error !== null ? (
        <p role="alert" className="text-[13px] text-failed">
          {error}
        </p>
      ) : null}

      {initialCode !== "" ? (
        <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed text-ink-muted">
          <input
            type="checkbox"
            checked={sure}
            onChange={(e) => setSure(e.target.checked)}
            className="mt-[3px] h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          <span>
            I just ran <code className="font-mono">cira login</code> on a computer I am
            using, and it shows this code. Nobody sent me this link.
          </span>
        </label>
      ) : null}

      <button
        type="submit"
        disabled={!sure}
        aria-disabled={pending || undefined}
        className="btn btn-primary btn-lg"
      >
        {pending ? "Connecting..." : "Connect"}
      </button>

      <p className="text-[12px] leading-relaxed text-ink-subtle">
        This gives that terminal access to your Cira account. Only continue if you just
        ran <code className="font-mono">cira login</code> yourself.
      </p>
    </form>
  );
}
