import type { Service } from "@cira/core";

/**
 * The parts an app is made of, when it is made of more than one.
 *
 * Deliberately absent for the single-service app, which is almost every app:
 * "Services: app" tells nobody anything and makes a simple thing look
 * complicated. It appears exactly when there is something to explain - why one
 * entry on the shelf turned into two builds, and which half a browser is
 * actually talking to.
 *
 * Read-only on purpose. None of this was configured by anybody; it is what the
 * repository said it was, and the place to change it is the repository.
 */
export function ServicePanel({ services }: { services: Service[] }) {
  if (services.length < 2) return null;

  return (
    <section className="enter-up mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Made of</h2>
        <p className="text-[12px] text-ink-subtle">
          Found in the code, and built together
        </p>
      </div>

      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
        {services.map((service) => (
          <li
            key={service.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3"
          >
            <span className="font-mono text-[12.5px] font-medium text-ink">
              {service.slug}
            </span>

            {service.sourcePath === "" ? null : (
              <span className="eyebrow">{service.sourcePath}</span>
            )}

            <span className="min-w-0 flex-1 text-[12px] text-ink-muted">
              {service.dockerfile === null
                ? "Built from its own toolchain"
                : `Built from ${service.dockerfile}`}
              {/* The port belongs with the build detail rather than in the
                  badge beside it: the badge answers what this half is for, and
                  a number crammed into it answers a different question badly. */}
              {service.port === null ? "" : `, listening on ${service.port}`}
            </span>

            {/*
              Which half a browser reaches. The other one is running in the
              same place and answering the first over localhost, which is the
              whole reason this app has one address rather than two.
            */}
            <Role service={service} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Role({ service }: { service: Service }) {
  const front = service.hasWebUi === true;

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[var(--radius-edge)] border px-1.5 py-[3px] text-[10px] font-semibold tracking-[0.06em] uppercase ${
        front
          ? "border-live/40 bg-live/10 text-live"
          : "border-line bg-sunken text-ink-subtle"
      }`}
    >
      {front ? "Front door" : "Internal"}
    </span>
  );
}
