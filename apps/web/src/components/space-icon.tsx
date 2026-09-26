/**
 * A company's face: its logo when it has one, its first letter when not.
 *
 * The letter sits on the accent, as it always has. A logo sits on white
 * instead, whatever the theme: logos are drawn for paper, most of them are
 * dark marks on a transparent ground, and on a dark sidebar those would
 * vanish. The hairline keeps the white tile from bleeding into a light page.
 */
export function SpaceIcon({
  name,
  image,
  size = "sm",
}: {
  name: string;
  image?: string | null;
  /** `xs` sits in a list, `sm` heads the sidebar, `lg` is the one being edited. */
  size?: "xs" | "sm" | "lg";
}) {
  const dimensions = {
    xs: "h-[18px] w-[18px] text-[9.5px]",
    sm: "h-[26px] w-[26px] text-[12px]",
    lg: "h-14 w-14 text-[22px]",
  }[size];

  if (image) {
    return (
      <span
        aria-hidden="true"
        className={`${dimensions} relative flex shrink-0 overflow-hidden rounded-[var(--radius-edge)] bg-white`}
      >
        {/* A data URL already in the row: nothing for an image pipeline to do. */}
        <img src={image} alt="" className="h-full w-full object-cover" />
        {/* Over the picture, not under it, or a logo that fills the square hides it. */}
        <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-black/10 ring-inset" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${dimensions} flex shrink-0 items-center justify-center rounded-[var(--radius-edge)] bg-accent font-bold text-accent-ink`}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
