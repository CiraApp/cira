import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Stamps the colours onto <html> before the first paint.
 *
 * This runs ahead of React, so nobody watches a dark interface load as a white
 * one. It is deliberately tiny and duplicates a little of lib/theme: anything
 * imported here would have to be parsed and executed before the page renders,
 * and the only two facts it needs are which ink a colour carries and where the
 * preference is kept.
 */
export function ThemeScript() {
  const source = `(function(){try{
var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
var t=s?JSON.parse(s):null;
var hex=/^#[0-9a-f]{6}$/i;
if(!t||!hex.test(t.base||"")||!hex.test(t.accent||"")){
  var dark=matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme",dark?"dark":"light");
  return;
}
function lum(h){var n=parseInt(h.slice(1),16),c=[n>>16&255,n>>8&255,n&255].map(function(v){v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]}
function light(h){var l=lum(h);return (1.05/(l+0.05))>((l+0.05)/0.05)}
var r=document.documentElement;
r.style.setProperty("--user-base",t.base);
r.style.setProperty("--user-accent",t.accent);
r.style.setProperty("--user-accent-ink",light(t.accent)?"#ffffff":"#0a0a0c");
r.setAttribute("data-theme",light(t.base)?"dark":"light");
}catch(e){
// Storage or matchMedia refused. Dark is the design the system was drawn for,
// so it is the honest thing to fall back to rather than a white flash.
document.documentElement.setAttribute("data-theme","dark");
}})()`;

  return <script dangerouslySetInnerHTML={{ __html: source }} />;
}
