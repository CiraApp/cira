import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Stamps the colours onto <html> before the first paint.
 *
 * This runs ahead of React, so nobody watches the interface load as something
 * it is not. It is deliberately tiny and duplicates a little of lib/theme:
 * anything imported here would have to be parsed and executed before the page
 * renders, and the only two facts it needs are which ink a colour carries and
 * where the preference is kept.
 *
 * With no stored choice it stamps Cira's own colours rather than reading the
 * operating system - the default is a decision the product has made, not one
 * it delegates.
 */
export function ThemeScript() {
  const source = `(function(){
var d=${JSON.stringify(DEFAULT_THEME)};
var r=document.documentElement;
function lum(h){var n=parseInt(h.slice(1),16),c=[n>>16&255,n>>8&255,n&255].map(function(v){v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]}
function light(h){var l=lum(h);return (1.05/(l+0.05))>((l+0.05)/0.05)}
function paint(t){
r.style.setProperty("--user-base",t.base);
r.style.setProperty("--user-accent",t.accent);
r.style.setProperty("--user-accent-ink",light(t.accent)?"#ffffff":"#0a0a0c");
r.setAttribute("data-theme",light(t.base)?"dark":"light");
}
try{
var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
var t=s?JSON.parse(s):null;
var hex=/^#[0-9a-f]{6}$/i;
paint(t&&hex.test(t.base||"")&&hex.test(t.accent||"")?t:d);
}catch(e){
// Storage refused, or a hand-edited value would not parse. Neither is a
// reason to show the wrong interface, so the default is painted anyway.
paint(d);
}})()`;

  return <script dangerouslySetInnerHTML={{ __html: source }} />;
}
