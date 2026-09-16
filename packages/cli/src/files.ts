import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { shouldUpload, type BundleFile } from "@cira/deploy/packaging";

/**
 * Walk a project folder and list what should be deployed.
 *
 * Sizes only. This used to hash every file as well, because the deploy was
 * content-addressed and the hash was the address. The source travels as one
 * archive now, so the hashing was a second full read of the project for a
 * value nothing looked at.
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
        found.push({ path: rel, size: statSync(full).size });
      } catch {
        // Likewise for an unreadable file.
      }
    }
  };

  walk(root);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}
