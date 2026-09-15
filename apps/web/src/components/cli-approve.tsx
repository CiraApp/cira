"use client";

import { useState, useTransition } from "react";
import { approveCliLogin } from "@/lib/cli-approve-actions";

export function CliApprove({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await approveCliLogin(code);
      if (result.ok) setDone(result.label);
      else setError(result.error);
    });
  };

  if (done !== null) {
    return (
      <div className="animate-pop-in rounded-2xl border border-border bg-surface px-5 py-6 text-center">
        <p className="text-[15px] font-medium text-ink">You&rsquo;re connected</p>
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
        className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center font-mono text-[18px] tracking-[0.2em] text-ink uppercase outline-none placeholder:tracking-normal placeholder:text-ink-subtle focus:border-accent focus:ring-4 focus:ring-accent/12"
      />

      {error !== null ? (
        <p role="alert" className="text-[13px] text-failed">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-accent px-5 py-3 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
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
