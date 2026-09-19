import type { Limits } from "@cira/core";
import { CopyableCommand } from "./copyable-command";

/**
 * How an app gets here.
 *
 * Three commands, in order, with what each one does. Deploying is a developer
 * task, so this page is allowed to look like a terminal; it is not allowed to
 * assume you already know the sequence.
 */
export function DeployGuide({
  spaceSlug,
  appCount,
  limits,
}: {
  spaceSlug: string;
  /** Apps this space holds now, against its allowance. */
  appCount: number;
  limits: Limits;
}) {
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
      note: "From the folder holding your app, in any language, with or without a Dockerfile.",
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
              "Dependencies and build output stay on your machine. Values from .env go to the running app, never into the upload.",
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

        {/*
          The allowance, stated where deploying starts rather than first met as
          a refusal from the CLI. Read from the same record the server enforces.
        */}
        <div className="mt-5 border-t border-line pt-4">
          <p className="eyebrow">Limits</p>
          <dl className="mt-2.5 flex flex-col gap-1.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-subtle">Apps in this space</dt>
              <dd className="tabular text-ink">
                {appCount} of {limits.appsPerSpace}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-subtle">Deploys an hour</dt>
              <dd className="tabular text-ink">{limits.deploysPerSpacePerHour}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-subtle">Each app</dt>
              <dd className="text-right text-ink">
                {limits.app.maxInstances} instances, {limits.app.cpu} CPU,{" "}
                {limits.app.memoryMiB} MB
              </dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  );
}
