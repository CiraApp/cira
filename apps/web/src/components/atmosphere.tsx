/**
 * The atmosphere behind the product.
 *
 * Cloud strata rather than clouds: layered translucent forms at different
 * depths, drifting at different speeds so the parallax does the work of
 * suggesting sky without anything ever looking like a drawing of one. Nothing
 * here is a picture, so nothing here can look childish.
 *
 * Pure CSS on composited layers. The browser animates transforms it has
 * already rasterised, so an ambient background that runs forever costs no
 * per-frame painting and no main-thread work. Under reduced motion the layers
 * stay exactly where they are and the depth survives without the drift.
 */
export function Atmosphere() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* High haze: the widest, faintest, slowest layer. */}
      <div
        className="stratum stratum-a -top-[30%] -left-[18%] h-[85vh] w-[85vw] opacity-[0.55] dark:opacity-40"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--gold-metal) 26%, transparent), transparent 100%)",
        }}
      />

      {/* Mid stratum, drawn toward the working area but kept off-centre. */}
      <div
        className="stratum stratum-b top-[18%] -right-[22%] h-[75vh] w-[78vw] opacity-45 dark:opacity-[0.3]"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--gold-metal) 20%, transparent), transparent 100%)",
        }}
      />

      {/* Low bank: cooler and heavier, so the strata read as depth not as one wash. */}
      <div
        className="stratum stratum-c -bottom-[28%] left-[14%] h-[70vh] w-[90vw] opacity-40 dark:opacity-25"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--color-ink) 9%, transparent), transparent 100%)",
        }}
      />

      {/* A single bloom holding the top of the page, where the eye lands first. */}
      <div
        className="absolute -top-[36%] left-1/2 h-[62vh] w-[120vw] -translate-x-1/2 opacity-70 blur-[70px] dark:opacity-50"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--gold-highlight) 55%, transparent), transparent 100%)",
        }}
      />
    </div>
  );
}
