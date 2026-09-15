import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { shouldUpload, type BundleFile } from "@cira/deploy";

/**
 * Walk a project folder and hash what should be deployed.
 *
 * SHA-1 because that is how the content is addressed on the receiving end;
 * it identifies a file here, it does not protect anything.
 */
export function collectFiles(root: string): BundleFile[] {
  const found: BundleFile[] = [];

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // An unreadable folder is skipped rather than failing the whole deploy.
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");

      if (!shouldUpload(rel)) continue;

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      try {
        const body = readFileSync(full);
        found.push({
          path: rel,
          size: body.byteLength,
          sha: createHash("sha1").update(body).digest("hex"),
        });
      } catch {
        // Likewise for an unreadable file.
      }
    }
  };

  walk(root);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

export function readFileBody(root: string, relativePath: string): Buffer {
  return readFileSync(join(root, relativePath));
}

/**
 * The same files, with their text, for capability analysis.
 *
 * Read from disk a second time rather than kept from `collectFiles`, because
 * the deploy bundle is hashes and sizes and holding every file's contents in
 * memory to save one pass would be the wrong trade in a CLI.
 *
 * Only what the extractor can read: a repository's images and fonts say
 * nothing about what it does.
 */
export function readSourceFiles(
  root: string,
  files: readonly BundleFile[],
): Array<{ path: string; text: string }> {
  const wanted = files.filter(
    (file) => file.path === "package.json" || /\.(ts|tsx|js|jsx|mjs)$/.test(file.path),
  );

  const out: Array<{ path: string; text: string }> = [];
  for (const file of wanted) {
    // A file big enough to be a bundle is not a file anyone wrote.
    if (file.size > 400_000) continue;
    try {
      out.push({ path: file.path, text: readFileSync(join(root, file.path), "utf8") });
    } catch {
      // Unreadable here is the same as absent: analysis is best effort.
    }
  }
  return out;
}
