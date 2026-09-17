import { appColor, appInitial } from "@/lib/app-color";

/**
 * An app's face: a cut square, not a bubble.
 *
 * It is the one coloured object on the screen, so it carries the weight the
 * monochrome chrome gives up. The inner hairline is what keeps it reading as a
 * solid tile rather than a coloured patch.
 */
export function AppIcon({
  appId,
  name,
  icon,
  image,
  size = "md",
}: {
  appId: string;
  name: string;
  icon?: string | null;
  /** A picture chosen for the app. Wins over the letter when there is one. */
  image?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const color = appColor(appId);

  const dimensions = {
    sm: "h-7 w-7 text-[11px] rounded-[3px]",
    md: "h-10 w-10 text-[15px] rounded-[4px]",
    lg: "h-14 w-14 text-[21px] rounded-[5px]",
  }[size];

  return (
    <span
      aria-hidden="true"
      style={
        {
          "--fg": color.fg,
          "--bg": color.bg,
          "--fg-dark": color.fgDark,
          "--bg-dark": color.bgDark,
        } as React.CSSProperties
      }
      className={`app-icon ${dimensions} flex shrink-0 items-center justify-center overflow-hidden font-semibold`}
    >
      {/*
        A picture fills the tile rather than sitting inside it, cropped to the
        square by the tile's own corners, so an app with one and an app without
        are the same object on the shelf and the grid does not flinch.

        A plain `img` rather than the framework's: the source is a data URL
        already sitting in the row, so there is nothing to fetch, resize or
        cache, and routing it through an image pipeline would only add work to
        bytes that have already arrived.
      */}
      {image ? (
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        (icon ?? appInitial(name))
      )}
    </span>
  );
}
