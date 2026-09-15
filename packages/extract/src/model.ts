/**
 * The compact description of an app that capability analysis reads.
 *
 * This is the whole reason a developer never writes a manifest: the shape of
 * the repository is recovered from the repository. It is deliberately small -
 * a few hundred lines of structure rather than a codebase - because the point
 * is to give analysis the signal and none of the noise.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * One HTTP endpoint the deployed app actually serves.
 *
 * Routes are the only thing a capability may ever point at, and they are
 * recovered from file paths and exported handler names rather than from
 * anything anyone wrote down - which is what makes the set trustworthy enough
 * to validate an analyzer's output against.
 */
export interface RouteSummary {
  /** Root-relative URL, e.g. `/api/revenue`. */
  path: string;
  methods: HttpMethod[];
  /** Where it came from, so a person can check the analyzer's homework. */
  file: string;
  /** True when the path contains a segment like `[id]`. */
  dynamic: boolean;
  /** The comment above the handler, when there is one. */
  doc: string | null;
  /** A trimmed look at the handler body - what it reads, what it returns. */
  excerpt: string;
}

/** An exported function that is not itself addressable over HTTP. */
export interface FunctionSummary {
  name: string;
  file: string;
  /** Source text of the signature, normalised to one line. */
  signature: string;
  doc: string | null;
  /** `"use server"` at the top of the file it lives in. */
  serverAction: boolean;
}

/** A type, interface or validation schema worth knowing the shape of. */
export interface ShapeSummary {
  name: string;
  file: string;
  kind: "interface" | "type" | "zod";
  text: string;
}

export interface RepoSummary {
  framework: "nextjs";
  packageName: string | null;
  /** Dependency names only; versions say nothing about what the app does. */
  dependencies: string[];
  routes: RouteSummary[];
  functions: FunctionSummary[];
  shapes: ShapeSummary[];
  /** Anything the extractor had to leave out, so analysis knows it is partial. */
  notes: string[];
}
