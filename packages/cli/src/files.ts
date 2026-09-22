import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import {
  isSecretFile,
  secretDependsOnContents,
  shouldUpload,
  type BuildStyle,
  type BundleFile,
} from "@cira/deploy/packaging";

/** What the walk found: what to send, and what it deliberately did not. */
export interface Collected {
  files: BundleFile[];
  /** Files that look like credentials, kept back. Named so the person knows. */
  withheld: string[];
  /** Which of the project's own ignore files were honoured. */
  ignoreFiles: string[];
}

/**
 * Walk a project folder and list what should be deployed.
 *
 * What is sent is what the build would be sent anyway. Under a Dockerfile
 * that is `docker build`'s view of the folder, so `.dockerignore` decides;
 * otherwise the repository's `.gitignore` files do, each one for the
 * directory it sits in, the way git reads them. `.ciraignore`, in the same
 * syntax, applies to both and has the last word - a `!` line in it can send
 * something the rest would hold back.
 *
 * Before this the walk used a fixed list of names and nothing else, which
 * meant a committed `.streamlit/secrets.toml` or `config/master.key` was
 * uploaded, built into the image and read by the model, and that `COPY
 * target/app.jar` failed because `target` was always dropped.
 *
 * Sizes only. This used to hash every file as well, because the deploy was
 * content-addressed and the hash was the address. The source travels as one
 * archive now, so the hashing was a second full read of the project for a
 * value nothing looked at.
 */
export function collectFiles(root: string, style: BuildStyle = "buildpacks"): Collected {
  const found: BundleFile[] = [];
  const withheld: string[] = [];
  const ignoreFiles: string[] = [];

  const cira = readIgnore(root, ".ciraignore");
  if (cira !== null) ignoreFiles.push(".ciraignore");

  // Docker reads one file at the root of the context; git reads one per
  // directory, each relative to where it sits.
  const docker = style === "dockerfile" ? readIgnore(root, ".dockerignore") : null;
  if (docker !== null) ignoreFiles.push(".dockerignore");

  const git: Array<{ base: string; rules: Ignore }> = [];

  const ignored = (rel: string, isDirectory: boolean): boolean => {
    const path = isDirectory ? `${rel}/` : rel;
    let out = false;
    if (docker !== null) {
      out = docker.ignores(path);
    } else {
      for (const { base, rules } of git) {
        if (base !== "" && !rel.startsWith(`${base}/`)) continue;
        const inside = base === "" ? path : path.slice(base.length + 1);
        const verdict = rules.test(inside);
        if (verdict.ignored) out = true;
        if (verdict.unignored) out = false;
      }
    }
    if (cira !== null) {
      const verdict = cira.test(path);
      if (verdict.ignored) out = true;
      if (verdict.unignored) out = false;
    }
    return out;
  };

  /** Named with `!` in `.ciraignore`: the person has said to send it. */
  const insisted = (rel: string): boolean => cira?.test(rel).unignored === true;

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // An unreadable folder is skipped rather than failing the whole deploy.
      return;
    }

    const here = relative(root, dir).split(sep).join("/");
    if (docker === null) {
      const rules = readIgnore(dir, ".gitignore");
      if (rules !== null) {
        git.push({ base: here, rules });
        ignoreFiles.push(here === "" ? ".gitignore" : `${here}/.gitignore`);
      }
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");

      if (entry.isDirectory()) {
        if (!shouldUpload(rel, style) || ignored(rel, true)) continue;
        // A virtual environment called anything at all. The fixed list knows
        // `venv` and `.venv`; Python itself marks every one with this file.
        if (existsSync(join(full, "pyvenv.cfg"))) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!shouldUpload(rel, style) || ignored(rel, false)) continue;

      if (!insisted(rel) && looksLikeCredential(full, rel)) {
        withheld.push(rel);
        continue;
      }

      try {
        found.push({ path: rel, size: statSync(full).size });
      } catch {
        // Likewise for an unreadable file.
      }
    }
  };

  walk(root);
  return {
    files: found.sort((a, b) => a.path.localeCompare(b.path)),
    withheld: withheld.sort(),
    ignoreFiles,
  };
}

function looksLikeCredential(full: string, rel: string): boolean {
  if (!secretDependsOnContents(rel)) return isSecretFile(rel);
  try {
    return isSecretFile(rel, readFileSync(full, "utf8").slice(0, 64 * 1024));
  } catch {
    return isSecretFile(rel);
  }
}

function readIgnore(dir: string, name: string): Ignore | null {
  let text;
  try {
    text = readFileSync(join(dir, name), "utf8");
  } catch {
    return null;
  }
  return ignore().add(text);
}
