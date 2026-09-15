import { appColor, appInitial } from "@/lib/app-color";

/**
 * An app's face.
 *
 * Built to read as an icon rather than a letter in a box: a squircle radius,
 * a hairline that catches the edge, and a wash that lifts slightly toward the
 * light. It is the one coloured object on the screen, so it carries the
 * weight the chrome gives up.
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
    sm: "h-8 w-8 rounded-[9px] text-[13px]",
    md: "h-12 w-12 rounded-[14px] text-[19px]",
    lg: "h-16 w-16 rounded-[19px] text-[26px]",
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
