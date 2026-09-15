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
