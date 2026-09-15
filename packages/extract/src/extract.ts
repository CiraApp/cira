import type {
  FunctionSummary,
  HttpMethod,
  RepoSummary,
  RouteSummary,
  ShapeSummary,
} from "./model.js";

/** One source file, as the extractor sees it. */
export interface SourceInput {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  text: string;
}

const HTTP_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Budgets. The output is read by a model, so it has to stay small enough to
 * be read carefully rather than skimmed - and a repository that blows through
 * these says so in `notes` rather than being silently cut in half.
 */
const LIMITS = {
  routes: 60,
  functions: 80,
  shapes: 60,
  excerptChars: 900,
  shapeChars: 700,
  fileChars: 120_000,
} as const;

/**
 * Read a Next.js project's shape without compiling it.
 *
 * Deliberately a scanner rather than a parser. The one fact that has to be
 * exactly right is the set of routes the app serves, and that comes from file
 * paths and exported handler names - the most reliable signal in a Next.js
 * repository and one no parser would improve on. Everything else here is
 * context for a model that is going to be checked against those routes
 * anyway, so being approximate about it costs nothing and keeps the CLI from
 * carrying a compiler.
 */
export function extractRepo(files: readonly SourceInput[]): RepoSummary {
  const notes: string[] = [];
  const summary: RepoSummary = {
    framework: "nextjs",
    packageName: null,
    dependencies: [],
    routes: [],
    functions: [],
    shapes: [],
    notes,
  };

  const source = files.filter((f) => isInteresting(f.path));

  const manifest = files.find((f) => f.path === "package.json");
  if (manifest !== undefined) {
    const parsed = readManifest(manifest.text);
    summary.packageName = parsed.name;
    summary.dependencies = parsed.dependencies;
  }

  for (const file of source) {
    if (file.text.length > LIMITS.fileChars) {
      notes.push(`${file.path} was too large to read.`);
      continue;
    }

    const route = readRoute(file);
    if (route !== null) summary.routes.push(route);

    summary.functions.push(...readFunctions(file));
    summary.shapes.push(...readShapes(file));
  }

  summary.routes.sort((a, b) => a.path.localeCompare(b.path));
  summary.functions.sort((a, b) => a.name.localeCompare(b.name));
  summary.shapes.sort((a, b) => a.name.localeCompare(b.name));

  summary.routes = cap(summary.routes, LIMITS.routes, "routes", notes);
  summary.functions = cap(summary.functions, LIMITS.functions, "functions", notes);
  summary.shapes = cap(summary.shapes, LIMITS.shapes, "shapes", notes);

  return summary;
}

function cap<T>(items: T[], limit: number, what: string, notes: string[]): T[] {
  if (items.length <= limit) return items;
  notes.push(`Only the first ${limit} ${what} of ${items.length} are described here.`);
  return items.slice(0, limit);
}

/**
 * Worth reading at all?
 *
 * Excludes what the spec calls noise, plus the two things that waste the most
 * room in a Next.js repo: generated output and presentational components,
 * neither of which ever describes a business operation.
 */
function isInteresting(path: string): boolean {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(path)) return false;

  const noisy = [
    "node_modules/",
    ".next/",
    "dist/",
    "build/",
    "out/",
    "coverage/",
    "public/",
    ".turbo/",
    ".vercel/",
  ];
  if (noisy.some((prefix) => path.includes(prefix))) return false;

  if (/\.(test|spec)\.[tj]sx?$/.test(path)) return false;
  if (/\.d\.ts$/.test(path)) return false;
  if (/(^|\/)(next-env|next\.config|tailwind\.config|postcss\.config)\b/.test(path)) {
    return false;
  }

  return true;
}

function readManifest(text: string): { name: string | null; dependencies: string[] } {
  try {
    const pkg = JSON.parse(text) as {
      name?: unknown;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      name: typeof pkg.name === "string" ? pkg.name : null,
      // Names only: a version number says nothing about what an app does, and
      // the list is here to hint at the domain (a database client, a payments
      // SDK) rather than to describe a build.
      dependencies: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort(),
    };
  } catch {
    return { name: null, dependencies: [] };
  }
}

/**
 * The URL a route file answers on, or null when the file is not a route.
 *
 * Handles both routers because a real internal app is often half-migrated,
 * and both put the answer in the path rather than in the code.
 */
export function routePathFor(file: string): string | null {
  const path = file.replace(/^\.\//, "");

  // App Router: app/**/route.ts, optionally under src/.
  const app = /^(?:src\/)?app\/(.*\/)?route\.[tj]sx?$/.exec(path);
  if (app !== null) {
    const segments = (app[1] ?? "")
      .split("/")
      .filter((s) => s !== "")
      // Route groups and private folders are organisational only; they never
      // appear in the URL the app actually serves.
      .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
      .filter((s) => !s.startsWith("_"));
    return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
  }

  // Pages Router: pages/api/**.ts
  const pages = /^(?:src\/)?pages\/(api\/.*)\.[tj]sx?$/.exec(path);
  if (pages !== null) {
    const withoutIndex = (pages[1] ?? "").replace(/\/index$/, "");
    return `/${withoutIndex}`;
  }

  return null;
}

function readRoute(file: SourceInput): RouteSummary | null {
  const path = routePathFor(file.path);
  if (path === null) return null;

  const isAppRouter = /^(?:src\/)?app\//.test(file.path.replace(/^\.\//, ""));

  const methods = isAppRouter
    ? HTTP_METHODS.filter((method) => exportsHandler(file.text, method))
    : methodsFromPagesHandler(file.text);

  if (methods.length === 0) return null;

  return {
    path,
    methods,
    file: file.path,
    dynamic: path.includes("["),
    doc:
      leadingDoc(file.text, new RegExp(`(?:async\\s+)?function\\s+${methods[0]}\\b`)) ??
      fileDoc(file.text),
    excerpt: trim(stripImports(file.text), LIMITS.excerptChars),
  };
}

/** `export function GET`, `export async function GET`, `export const GET =`. */
function exportsHandler(text: string, method: HttpMethod): boolean {
  const patterns = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`),
    new RegExp(`export\\s+(?:const|let|var)\\s+${method}\\s*[:=]`),
    new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`),
  ];
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * A Pages Router handler is one default export that branches on the method
 * itself, so the methods are read from the branches. When it does not branch,
 * it answers everything, and saying so is more honest than guessing one.
 */
function methodsFromPagesHandler(text: string): HttpMethod[] {
  if (!/export\s+default\s/.test(text)) return [];

  const found = HTTP_METHODS.filter((method) =>
    new RegExp(`method\\s*===?\\s*["'\`]${method}["'\`]`, "i").test(text),
  );

  return found.length > 0 ? found : ["GET", "POST"];
}

/**
 * Exported functions that are not HTTP handlers.
 *
 * They can never be a capability target on their own - nothing outside the app
 * can call them - but they are usually where the business vocabulary lives, so
 * they are what lets analysis tell a revenue query from a cache helper.
 */
function readFunctions(file: SourceInput): FunctionSummary[] {
  const serverAction = /^\s*["']use server["']/m.test(file.text);
  const found: FunctionSummary[] = [];

  const pattern =
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)([^{;]*)/g;

  for (const match of file.text.matchAll(pattern)) {
    const name = match[1];
    if (name === undefined) continue;
    // Route handlers are already described as routes; repeating them here
    // would spend the budget saying the same thing twice.
    if ((HTTP_METHODS as readonly string[]).includes(name)) continue;

    found.push({
      name,
      file: file.path,
      signature: oneLine(`${name}(${match[2] ?? ""})${match[3] ?? ""}`),
      doc: leadingDoc(file.text, new RegExp(`function\\s+${name}\\b`)),
      serverAction,
    });
  }

  return found;
}

/**
 * Types, interfaces and validation schemas.
 *
 * A zod schema beside a route is the closest thing a normal codebase has to a
 * written-down input contract, which is exactly what a capability needs, so
 * they are worth the room they take.
 */
function readShapes(file: SourceInput): ShapeSummary[] {
  const found: ShapeSummary[] = [];

  for (const match of file.text.matchAll(
    /export\s+interface\s+([A-Za-z_$][\w$]*)\s*(?:extends[^{]*)?\{/g,
  )) {
    const name = match[1];
    if (name === undefined || match.index === undefined) continue;
    found.push({
      name,
      file: file.path,
      kind: "interface",
      text: trim(block(file.text, match.index), LIMITS.shapeChars),
    });
  }

  for (const match of file.text.matchAll(
    /export\s+type\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]{0,400});/g,
  )) {
    const name = match[1];
    if (name === undefined) continue;
    found.push({
      name,
      file: file.path,
      kind: "type",
      text: oneLine(`type ${name} = ${match[2] ?? ""}`),
    });
  }

  for (const match of file.text.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*z\s*\.\s*object\s*\(/g,
  )) {
    const name = match[1];
    if (name === undefined || match.index === undefined) continue;
    found.push({
      name,
      file: file.path,
      kind: "zod",
      text: trim(block(file.text, match.index), LIMITS.shapeChars),
    });
  }

  return found;
}

/** The comment immediately above the first line matching `anchor`. */
function leadingDoc(text: string, anchor: RegExp): string | null {
  const at = text.search(anchor);
  if (at === -1) return null;

  const before = text.slice(0, at);
  // Whatever modifiers sit between the comment and the declaration -
  // `export`, `async`, `const` - the comment is still the comment.
  const jsdoc =
    /\/\*\*([\s\S]*?)\*\/(?:\s*(?:export|default|async|const|let|var))*\s*$/.exec(before);
  if (jsdoc !== null) {
    return oneLine((jsdoc[1] ?? "").replace(/^\s*\*/gm, " ")).slice(0, 400);
  }

  const lines = before.split("\n");
  const comments: string[] = [];
  for (let i = lines.length - 2; i >= 0; i -= 1) {
    const line = (lines[i] ?? "").trim();
    if (line.startsWith("//")) comments.unshift(line.slice(2).trim());
    else break;
  }
  return comments.length > 0 ? comments.join(" ").slice(0, 400) : null;
}

/** The comment block at the very top of a file. */
function fileDoc(text: string): string | null {
  const match = /^\s*\/\*\*([\s\S]*?)\*\//.exec(text);
  if (match === null) return null;
  return oneLine((match[1] ?? "").replace(/^\s*\*/gm, " ")).slice(0, 400);
}

/** From `start`, the balanced `{...}` that follows it. */
function block(text: string, start: number): string {
  const open = text.indexOf("{", start);
  if (open === -1) return text.slice(start, start + LIMITS.shapeChars);

  let depth = 0;
  for (let i = open; i < text.length && i < open + LIMITS.shapeChars * 2; i += 1) {
    const char = text[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start, start + LIMITS.shapeChars);
}

/** Imports are the least informative lines in any file; drop them first. */
function stripImports(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*import\s/.test(line) && !/^\s*export\s+\*/.test(line))
    .join("\n")
    .trim();
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trim(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n// ...trimmed`;
}
