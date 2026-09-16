import { CopyableCommand } from "./copyable-command";

/**
 * How an app gets here.
 *
 * Three commands, in order, with what each one does. Deploying is a developer
 * task, so this page is allowed to look like a terminal; it is not allowed to
 * assume you already know the sequence.
 */
export function DeployGuide({ spaceSlug }: { spaceSlug: string }) {
  const steps = [
    {
      title: "Install the CLI",
      note: "Once per machine.",
      command: "npm i -g @cira-app/cli",
    },
    {
      title: "Connect your account",
      note: "Opens a browser to confirm it is you. Works over SSH.",
      command: "cira login",
    },
    {
      title: "Ship it",
      note: "From the folder holding your Next.js app.",
      // Always named, even for someone with a single space. The command is
      // copied into a script or a README as often as it is run here, and one
      // that stops working the day its author joins a second company is worse
      // than one extra flag.
      command: `cira deploy --space ${spaceSlug}`,
    },
  ];

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <ol className="enter-up flex min-w-0 flex-1 flex-col">
        {steps.map((step, i) => (
          <li key={step.title} className="relative flex gap-4 pb-7 last:pb-0">
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-7 bottom-0 left-[13px] w-px bg-line"
              />
            ) : null}

            <span
              aria-hidden="true"
              className="tabular relative z-10 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-[var(--radius-edge)] border border-line bg-surface text-[12px] font-semibold text-ink-muted"
            >
              {i + 1}
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <h2 className="text-[13px] font-semibold text-ink">{step.title}</h2>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-subtle">
                {step.note}
              </p>
              <div className="mt-2.5">
                <CopyableCommand command={step.command} />
              </div>
            </div>
          </li>
        ))}
      </ol>

      <aside className="enter-up w-full shrink-0 rounded-[var(--radius-edge)] border border-line bg-surface p-5 lg:w-[310px]">
        <p className="eyebrow">What happens</p>
        <ul className="mt-3 flex flex-col gap-3">
          {[
            [
              "Your folder is packaged",
              "Dependencies, build output and any .env stay on your machine.",
            ],
            ["Cira builds and hosts it", "You never touch the cloud account underneath."],
            [
              "It appears here, private",
              "Only you can open it until you give someone access.",
            ],
          ].map(([title, note]) => (
            <li key={title} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent"
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-ink">{title}</span>
                <span className="block text-[12px] leading-relaxed text-ink-subtle">
                  {note}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
