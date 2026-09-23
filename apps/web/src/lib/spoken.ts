/**
 * An answer as it should be heard. The text is markdown for the eye; read
 * raw, "**one delayed shipment**" came out with its asterisks.
 */
export function spoken(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|\*|`)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
