/**
 * Turning what software calls things into what people call them.
 *
 * Ask Cira is for the people in a company who do not write software, and the
 * quickest way to lose them is a word like `getRevenue` or `invoice_id`. These
 * are used on both sides: the server labels its steps with them, and the panel
 * uses them for the rows of a confirmation.
 */

/** Short words that read wrong in lower case: "Invoice ID", not "Invoice id". */
const ACRONYMS: Record<string, string> = {
  id: "ID",
  ids: "IDs",
  url: "URL",
  api: "API",
  sku: "SKU",
  sso: "SSO",
  csv: "CSV",
  http: "HTTP",
};

/** "getRevenue" -> "Get revenue", "invoice_id" -> "Invoice ID". */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");

  if (words.length === 0) return name;
  const sentence = words.map((word) => ACRONYMS[word] ?? word).join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * A short account of what something was asked for: "2026-08-01, 2026-08-31".
 *
 * Scalars only, and only a few of them. An object or a list is detail the step
 * line has no room for and the person can read under "See the data".
 */
export function summarizeInput(input: Record<string, unknown>): string {
  const shown: string[] = [];
  for (const value of Object.values(input)) {
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue;
    }
    const text = String(value).trim();
    if (text === "") continue;
    shown.push(text.length > 28 ? `${text.slice(0, 27)}…` : text);
    if (shown.length === 3) break;
  }
  return shown.join(", ");
}

/**
 * Shorten what an app returned before the model reads it.
 *
 * An app may answer with up to a megabyte, and sending that to the model on
 * every later turn of the conversation is how one question comes to cost a
 * dollar. The cut is told to the model in words, so it can say the answer is
 * partial rather than presenting a fragment as the whole. The person still
 * sees everything, under "See the data".
 */
export function trimForModel(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return (
    `${text.slice(0, limit)}\n\n[Trimmed: the app returned ${text.length.toLocaleString("en-US")} ` +
    `characters and only the first ${limit.toLocaleString("en-US")} are shown here. ` +
    `If the answer depends on the rest, say that it is partial.]`
  );
}
