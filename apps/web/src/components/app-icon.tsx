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
  size = "md",
}: {
  appId: string;
  name: string;
  icon?: string | null;
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
      className={`app-icon ${dimensions} flex shrink-0 items-center justify-center font-semibold`}
    >
      {icon ?? appInitial(name)}
    </span>
  );
}
