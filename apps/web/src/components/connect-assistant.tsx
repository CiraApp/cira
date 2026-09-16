"use client";

import { useActionState, useEffect, useState } from "react";
import { Portal } from "@/components/ui/portal";
import {
  createAssistantToken,
  listAssistantTokens,
  revokeAssistantToken,
  type TokenSummary,
} from "@/lib/assistant-actions";

/**
 * The front door to Cira's agent surface.
 *
 * Everything needed to reach a company's software from an assistant already
 * worked - the endpoint, the tokens, the permission checks - and none of it was
 * visible anywhere in the product, so the only people who could use it were the
 * ones who had read the source. This is that door, in the one place a person
 * looks at all day.
 *
 * The credential is per person on purpose. An agent holding it sees exactly the
 * capabilities its owner is allowed to see, which is why this cannot be one key
 * an administrator pastes in for a whole company.
 */
export function ConnectAssistant({ connected }: { connected: TokenSummary | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group w-full rounded-[var(--radius-edge)] border border-line bg-sunken/40 p-3 text-left transition-colors duration-200 hover:border-line-strong hover:bg-sunken"
      >
        {connected === null ? (
          <>
            <p className="eyebrow">Connect your assistant</p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
              Reach these apps from Claude, Cursor or Codex.
            </p>
            <p className="mt-2.5 text-[12px] font-medium text-ink-subtle transition-colors group-hover:text-ink">
              Connect &rarr;
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden="true" />
              Assistant connected
            </p>
            <p className="mt-2 truncate text-[12px] text-ink-muted">{connected.label}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">
              {connected.lastUsedAt === null
                ? "not used yet"
                : `last used ${ago(connected.lastUsedAt)}`}
            </p>
            <p className="mt-2.5 text-[12px] font-medium text-ink-subtle transition-colors group-hover:text-ink">
              Manage &rarr;
            </p>
          </>
        )}
      </button>

      {open ? <Dialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Dialog({ onClose }: { onClose: () => void }) {
  const [endpoint, setEndpoint] = useState("");
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [client, setClient] = useState<ClientId>("claude-code");
  const [state, create, creating] = useActionState(createAssistantToken, null);

  // The endpoint is whichever Cira this is, rather than a configured constant
  // that can disagree with the address in the address bar.
  useEffect(() => setEndpoint(`${window.location.origin}/api/mcp`), []);
  useEffect(() => {
    void listAssistantTokens().then(setTokens);
  }, [state]);

  const token = state?.ok === true ? state.data.token : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <Portal>
      <div
        className="enter-fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-sunken/70 px-5 py-[8vh] backdrop-blur-[3px]"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="connect-title"
          className="enter-pop w-full max-w-lg rounded-[var(--radius-edge)] border border-line-strong bg-raised p-6 shadow-[var(--shadow-panel)]"
        >
          <h2
            id="connect-title"
            className="text-[15px] font-semibold tracking-[-0.01em] text-ink"
          >
            Connect your assistant
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
            Your assistant can search and run the company software you already have access
            to. It sees what you can see, not what your colleagues can.
          </p>

          <Step n={1} label="Endpoint" />
          <Copyable value={endpoint} />

          <Step n={2} label="Token" />
          {token === null ? (
            <form action={create} className="flex items-center gap-2">
              <label htmlFor="token-label" className="sr-only">
                What is this token for
              </label>
              <input
                id="token-label"
                name="label"
                required
                defaultValue={deviceName()}
                className="field flex-1 py-2 text-[13px]"
              />
              <button type="submit" disabled={creating} className="btn btn-primary">
                {creating ? "Creating..." : "Create"}
              </button>
            </form>
          ) : (
            <>
              <Copyable value={token} mono />
              <p className="mt-1.5 text-[11.5px] text-ink-subtle">
                Shown once. Create another if you lose it - they cost nothing.
              </p>
            </>
          )}
          {state?.ok === false ? (
            <p role="alert" className="mt-1.5 text-[12.5px] text-failed">
              {state.error}
            </p>
          ) : null}

          <Step n={3} label="Add it" />
          <div className="flex flex-wrap gap-1.5">
            {CLIENTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setClient(entry.id)}
                data-current={client === entry.id ? "true" : undefined}
                className="rounded-[var(--radius-edge)] border border-line px-2.5 py-1 text-[12px] text-ink-subtle transition-colors hover:text-ink data-[current]:border-accent data-[current]:text-ink"
              >
                {entry.name}
              </button>
            ))}
          </div>
          <div className="mt-2.5">
            <Copyable
              value={snippet(client, endpoint, token ?? "YOUR_TOKEN")}
              mono
              block
            />
          </div>
          <p className="mt-2 text-[11.5px] text-ink-subtle">
            {CLIENTS.find((entry) => entry.id === client)?.hint}
          </p>

          <p className="mt-4 rounded-[var(--radius-edge)] bg-sunken/60 px-3 py-2.5 text-[12.5px] text-ink-muted">
            Then ask it:{" "}
            <span className="text-ink">&ldquo;what can I do here?&rdquo;</span>
          </p>

          <div className="mt-5 border-t border-line pt-3.5">
            <p className="eyebrow">Your tokens</p>
            {tokens === null ? (
              <p className="mt-2 text-[12px] text-ink-subtle">Loading...</p>
            ) : tokens.length === 0 ? (
              <p className="mt-2 text-[12px] text-ink-subtle">None yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {tokens.map((entry) => (
                  <TokenRow
                    key={entry.id}
                    token={entry}
                    onRevoked={() => void listAssistantTokens().then(setTokens)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="mt-5 flex justify-end">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              Done
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function TokenRow({ token, onRevoked }: { token: TokenSummary; onRevoked: () => void }) {
  const [state, revoke, pending] = useActionState(revokeAssistantToken, null);

  useEffect(() => {
    if (state?.ok === true) onRevoked();
  }, [state, onRevoked]);

  return (
    <li className="flex items-center gap-3 py-1 text-[12px]">
      <span className="min-w-0 flex-1 truncate text-ink-muted">{token.label}</span>
      <span className="shrink-0 text-[11.5px] text-ink-subtle">
        {token.lastUsedAt === null ? "unused" : `used ${ago(token.lastUsedAt)}`}
      </span>
      <form action={revoke}>
        <input type="hidden" name="id" value={token.id} />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 text-[11.5px] text-ink-subtle transition-colors hover:text-failed"
        >
          {pending ? "..." : "Revoke"}
        </button>
      </form>
    </li>
  );
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <p className="eyebrow mt-5 mb-2">
      {n} &middot; {label}
    </p>
  );
}

function Copyable({
  value,
  mono = false,
  block = false,
}: {
  value: string;
  mono?: boolean;
  block?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-start gap-2">
      <code
        className={`min-w-0 flex-1 rounded-[var(--radius-edge)] border border-line bg-sunken px-2.5 py-2 text-[12px] text-ink-muted ${
          mono ? "font-mono" : ""
        } ${block ? "block whitespace-pre-wrap break-all" : "truncate"}`}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          });
        }}
        className="btn btn-secondary shrink-0"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

type ClientId = "claude-code" | "claude-desktop" | "cursor" | "other";

const CLIENTS: Array<{ id: ClientId; name: string; hint: string }> = [
  {
    id: "claude-code",
    name: "Claude Code",
    hint: "Run this in a terminal. Or let the CLI do every assistant on this machine at once: cira mcp connect",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    hint: "Customize > Connectors > Add custom connector. Paste the endpoint above, set Authentication to No sign-in, then under Request headers choose authorization and paste this value. Keep the word Bearer and the space: Claude sends it exactly as typed. The Request headers section is in beta, so it may not be there yet.",
  },
  { id: "cursor", name: "Cursor", hint: "Add this to ~/.cursor/mcp.json." },
  {
    id: "other",
    name: "Anything else",
    hint: "Any MCP client that speaks streamable HTTP and can send a header.",
  },
];

function snippet(client: ClientId, endpoint: string, token: string): string {
  switch (client) {
    case "claude-code":
      return `claude mcp add --scope user --transport http cira ${endpoint} \\\n  --header "Authorization: Bearer ${token}"`;
    // Desktop takes a header value rather than a command, and sends it
    // verbatim, so the scheme is part of what gets copied.
    case "claude-desktop":
      return `Bearer ${token}`;
    case "cursor":
      return `{
  "mcpServers": {
    "cira": {
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}`;
    case "other":
      return `POST ${endpoint}\nAuthorization: Bearer ${token}`;
  }
}

/** A name someone will recognise in the list later, without asking them to think. */
function deviceName(): string {
  if (typeof navigator === "undefined") return "My assistant";
  const ua = navigator.userAgent;
  const os = /mac/i.test(ua)
    ? "Mac"
    : /windows/i.test(ua)
      ? "Windows"
      : /linux/i.test(ua)
        ? "Linux"
        : "this machine";
  return `Assistant on ${os}`;
}

function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
