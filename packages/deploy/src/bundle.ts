/**
 * Deciding what of a project folder is worth uploading.
 *
 * Kept free of the filesystem so the rules can be tested directly, and so the
 * same decisions apply whoever is walking the tree.
 */

/**
 * Never uploaded, whatever the project's own ignore files say. Dependencies
 * and caches are reproduced by the build, and the rest is private, enormous,
 * or both.
 *
 * This list was written when Cira only deployed Next.js and stayed that way
 * after it stopped. Deploying Wave sent 154 files of compiled Python bytecode -
 * 44% of the upload - and a repository with its virtual environment beside it
 * would have sent hundreds of megabytes and failed on the size limit, for
 * files the build regenerates before it uses them. A virtual environment with
 * any other name is recognised by the walker from its `pyvenv.cfg`.
 */
const EXCLUDED_DIRECTORIES = new Set([
  // JavaScript
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".angular",
  ".turbo",
  ".vercel",
  // Python
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".eggs",
  // JVM
  ".gradle",
  // Everyone
  ".git",
  ".cira",
  "coverage",
  ".cache",
  ".DS_Store",
  // Credentials kept beside a project, never meant for a build.
  ".aws",
  ".ssh",
  ".gnupg",
]);

/**
 * Build output. A buildpacks build makes its own, so a stale local copy is
 * only weight. A Dockerfile is different: `COPY target/*.jar` and
 * `COPY dist/ /usr/share/nginx/html` are how a great many Dockerfiles are
 * written, and dropping these broke them. Under a Dockerfile, what is sent is
 * what `docker build` would be sent, which is `.dockerignore`'s business.
 */
const BUILD_OUTPUT_DIRECTORIES = new Set(["dist", "build", "out", "target"]);

/**
 * Deliberately not excluded, though it looks like it belongs above.
 *
 * `vendor` is dependencies in PHP and in Go - but a Go module that commits it
 * builds *from* it, and dropping it would turn a working repository into one
 * that cannot resolve its own imports. Sending it costs space; removing it
 * costs correctness, and only one of those is recoverable.
 */
export const KEPT_DESPITE_LOOKING_LIKE_JUNK = ["vendor"] as const;

const EXCLUDED_FILE_PATTERNS = [
  /^\.env($|\.)/,
  /\.log$/,
  /^\.DS_Store$/,
  /\.tsbuildinfo$/,
  /^npm-debug\.log/,
  /^yarn-error\.log/,
  // Compiled output, whatever produced it. The build makes its own.
  /\.py[co]$/,
];

/**
 * Files that hold credentials by convention, matched on the whole path.
 *
 * Never uploaded, and said so out loud. Everything uploaded is built into an
 * image and read by the model that works out what an app can do, so a
 * committed `secrets.toml` would otherwise reach both. The values belong in
 * variables, which Cira passes through without keeping (docs/secrets.md). A
 * project that genuinely ships one of these - a public certificate, say - can
 * name it with `!` in `.ciraignore`.
 */
const SECRET_PATTERNS = [
  // Local secrets for common frameworks.
  /(^|\/)\.streamlit\/secrets\.toml$/,
  /(^|\/)config\/master\.key$/,
  /(^|\/)config\/credentials\/[^/]+\.key$/,
  // Package manager and shell credentials.
  /(^|\/)\.npmrc$/,
  /(^|\/)\.yarnrc\.yml$/,
  /(^|\/)\.pypirc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.envrc$/,
  /(^|\/)\.git-credentials$/,
  // Key stores, which exist to hold private keys.
  /\.(p12|pfx|jks|keystore)$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  // Cloud service account files.
  /(^|\/)(credentials|client_secrets?|service[-_]account[^/]*|gcp[-_][^/]*key[^/]*)\.json$/,
  /(^|\/)[^/]*-credentials\.json$/,
  /(^|\/)firebase-adminsdk[^/]*\.json$/,
  // Terraform state holds every secret it ever created.
  /\.tfstate(\.backup)?$/,
];

export type BuildStyle = "dockerfile" | "buildpacks";

export function isExcludedDirectory(
  name: string,
  style: BuildStyle = "buildpacks",
): boolean {
  if (EXCLUDED_DIRECTORIES.has(name)) return true;
  return style === "buildpacks" && BUILD_OUTPUT_DIRECTORIES.has(name);
}

export function isExcludedFile(name: string, style: BuildStyle = "buildpacks"): boolean {
  if (name === ".env.example") return false;
  // Compiled Java a buildpacks build makes again; a Dockerfile may copy it.
  if (style === "buildpacks" && name.endsWith(".class")) return true;
  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Whether this path, relative to the project root, looks like it holds a
 * credential. Checked by the CLI before uploading and again by Cira before the
 * model reads anything, so an older CLI cannot send one to the model either.
 */
export function isSecretFile(relativePath: string, contents?: string): boolean {
  if (/(^|\/)\.env($|\.)/.test(relativePath) && !relativePath.endsWith(".env.example")) {
    return true;
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(relativePath))) return true;
  // A `.pem` is as often a public certificate an app needs - a database's CA
  // bundle - as a private key it must never ship, so the contents decide.
  // Without them, the careful answer.
  if (MAY_HOLD_A_KEY.test(relativePath)) {
    return contents === undefined || holdsPrivateKey(contents);
  }
  return false;
}

/** Whose contents decide whether they are a credential. */
const MAY_HOLD_A_KEY = /\.(pem|key)$/;

/** Whether this path's verdict depends on reading it. */
export function secretDependsOnContents(relativePath: string): boolean {
  return (
    MAY_HOLD_A_KEY.test(relativePath) &&
    !SECRET_PATTERNS.some((pattern) => pattern.test(relativePath))
  );
}

/** A PEM private key of any kind: RSA, EC, OpenSSH, PKCS#8, encrypted or not. */
export function holdsPrivateKey(contents: string): boolean {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(contents);
}

/** Should this path, relative to the project root, be uploaded? */
export function shouldUpload(
  relativePath: string,
  style: BuildStyle = "buildpacks",
): boolean {
  const segments = relativePath.split("/").filter((s) => s !== "");
  if (segments.length === 0) return false;

  for (const segment of segments.slice(0, -1)) {
    if (isExcludedDirectory(segment, style)) return false;
  }

  const name = segments[segments.length - 1];
  if (name === undefined) return false;
  if (isExcludedDirectory(name, style)) return false;
  return !isExcludedFile(name, style);
}

/** Uploading more than this is a mistake, not a big project. */
export const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface BundleFile {
  path: string;
  size: number;
}

export type BundleVerdict = { ok: true } | { ok: false; reason: string };

export function checkBundle(files: readonly BundleFile[]): BundleVerdict {
  if (files.length === 0) {
    return { ok: false, reason: "There is nothing to deploy in this folder." };
  }

  const oversized = files.find((f) => f.size > MAX_FILE_BYTES);
  if (oversized !== undefined) {
    return {
      ok: false,
      reason: `${oversized.path} is larger than 25 MB. Deployments carry source, not assets that big.`,
    };
  }

  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_BUNDLE_BYTES) {
    return {
      ok: false,
      reason:
        "This folder is over 100 MB. Something that should be ignored is probably being uploaded.",
    };
  }

  return { ok: true };
}
