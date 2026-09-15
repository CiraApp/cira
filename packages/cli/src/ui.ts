/** Terminal output. Colour only when a real terminal is attached. */
const useColour = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

const wrap = (code: string) => (text: string) =>
  useColour ? `\u001B[${code}m${text}\u001B[0m` : text;

export const dim = wrap("2");
export const bold = wrap("1");
export const green = wrap("32");
export const red = wrap("31");

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function success(message: string): void {
  process.stdout.write(`${green("OK")} ${message}\n`);
}

export function fail(message: string): void {
  process.stderr.write(`${red("Error")} ${message}\n`);
}
